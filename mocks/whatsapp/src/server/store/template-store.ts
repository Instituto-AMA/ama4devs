import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { FSWatcher } from 'chokidar'
import type { TemplateResolver } from '../template-resolver.ts'
import type {
	Template,
	TemplateComponent,
	TemplateStatus,
} from '../types/api-types.ts'
import {
	formatValidationErrorForAPI,
	validateTemplateData,
} from '../utils/validator.ts'
import { storeDatabase } from './database.ts'

/**
 * The id Meta would give a template: sixteen digits. It is derived from the
 * name and the language (FNV-1a), so a template keeps its id across restarts
 * without the file having to carry it.
 */
export function templateIdOf(name: string, language: string): string {
	let hash = 0xcbf29ce484222325n
	for (const char of `${name}\u0000${language}`) {
		hash ^= BigInt(char.codePointAt(0) ?? 0)
		hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
	}
	return `1${(hash % 1_000_000_000_000_000n).toString().padStart(15, '0')}`
}

/**
 * Where a template is in the review. A file without a status is a template
 * that was approved before the mock tracked reviews; a file with only the old
 * `review` field is in the state that review named.
 */
export function statusOf(template: Template): TemplateStatus {
	return template.status ?? template.review?.event ?? 'APPROVED'
}

/** Auto-generate variables from template components */
function generateVariablesFromTemplate(
	components: TemplateComponent[]
): Record<string, { description: string; example: string }> {
	const variables: Record<string, { description: string; example: string }> = {}
	const variableRegex = /\{\{([^}]+)\}\}/g

	for (const component of components) {
		if (component.text) {
			const matches = component.text.matchAll(variableRegex)
			for (const match of matches) {
				const variableName = match[1].trim()

				if (!variables[variableName]) {
					// Generate description based on variable name
					const description = generateVariableDescription(variableName)
					const example = generateVariableExample(variableName)

					variables[variableName] = {
						description,
						example,
					}
				}
			}
		}
	}

	return variables
}

/** Generate a description for a variable based on its name */
function generateVariableDescription(variableName: string): string {
	// Handle numeric variables
	if (/^\d+$/.test(variableName)) {
		return `Parameter ${variableName}`
	}

	// Convert snake_case or camelCase to readable format
	const readable = variableName
		.replace(/_/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.replace(/\b\w/g, (l) => l.toUpperCase())

	return readable
}

/** Generate an example value for a variable based on its name */
function generateVariableExample(variableName: string): string {
	// Handle numeric variables
	if (/^\d+$/.test(variableName)) {
		return 'Example Value'
	}

	// Generate examples based on common patterns
	const lowerName = variableName.toLowerCase()

	if (lowerName.includes('name')) return 'John Doe'
	if (lowerName.includes('email')) return 'user@example.com'
	if (lowerName.includes('phone')) return '+1234567890'
	if (lowerName.includes('date')) return 'December 15, 2024'
	if (lowerName.includes('time')) return '2:30 PM'
	if (lowerName.includes('location') || lowerName.includes('address'))
		return 'New York, NY'
	if (lowerName.includes('event')) return 'Wedding Reception'
	if (lowerName.includes('company') || lowerName.includes('business'))
		return 'ABC Company'
	if (lowerName.includes('amount') || lowerName.includes('price'))
		return '$100.00'
	if (lowerName.includes('order') || lowerName.includes('id')) return '12345'

	return 'Example Value'
}

/**
 * The template library of the mock.
 *
 * The library lives in the mock's database (`database.ts`): what the Cloud API
 * creates, edits, reviews and deletes is a row, and a restart keeps it. The
 * `templates/` folder is a seed: each JSON file is imported at start and
 * whenever it changes. A seed is imported again only when its content
 * changes, so a template deleted or edited through the API stays as the API
 * left it.
 *
 * `templates/examples/` holds the examples: one template per thing Meta lets
 * a template carry (each header format, the footer, every button type, a
 * carousel, named parameters, authentication), with the sample files of their
 * media headers in `templates/examples/media/`. They are seeds like any other;
 * the panel lists them apart from the application's own templates.
 */
export class TemplateStore {
	/** The rows, read once and kept in step with every write. */
	private templates: Map<string, Template> = new Map()
	/** The keys (name_language) of the templates seeded from the examples folder. */
	private examples: Set<string> = new Set()
	private watcher: FSWatcher | null = null
	private templatesDir: string
	private isWatching = false
	private templateResolver?: TemplateResolver
	private db: Database

	constructor(
		templatesDir = './templates',
		templateResolver?: TemplateResolver,
		db: Database = storeDatabase()
	) {
		// Resolve to absolute path to ensure consistent file watching.
		// Relative paths are resolved from the working directory, absolute paths
		// are kept as they are.
		this.templatesDir = resolve(process.cwd(), templatesDir)
		this.templateResolver = templateResolver
		this.db = db
	}

	/** Read the library, import the seeds and watch the seed folder. */
	async initialize(): Promise<void> {
		console.log('🗂️  Initializing template store...')

		if (this.templateResolver) {
			console.log('🔌 Using custom template resolution')
			console.log('📁 Template store initialized with custom resolver')
		} else {
			this.readLibrary()
			await this.loadAllTemplates()
			await this.startWatcher()

			console.log(
				`📁 Template store initialized with ${this.templates.size} templates`
			)
		}
	}

	/** The rows of the library, into the cache. */
	private readLibrary(): void {
		this.templates.clear()
		const rows = this.db
			.query<{ data: string }, []>('SELECT data FROM templates')
			.all()
		for (const row of rows) {
			const template = JSON.parse(row.data) as Template
			this.templates.set(`${template.name}_${template.language}`, template)
		}
	}

	private writeRow(template: Template): void {
		this.db
			.query(
				`INSERT INTO templates (id, name, language, data) VALUES (?, ?, ?, ?)
				 ON CONFLICT (name, language) DO UPDATE SET id = excluded.id, data = excluded.data`
			)
			.run(
				template.id ?? templateIdOf(template.name, template.language ?? 'en'),
				template.name,
				template.language ?? 'en',
				JSON.stringify(template)
			)
		this.templates.set(`${template.name}_${template.language}`, template)
	}

	/** Start file watcher for hot-reload functionality */
	private async startWatcher(): Promise<void> {
		if (this.isWatching) {
			return
		}

		// Watch the entire directory instead of just pattern matching
		console.log(
			`🔍 Setting up file watcher for directory: ${this.templatesDir}`
		)

		// Dynamic import chokidar to fix type issues
		try {
			const chokidarModule = await import('chokidar')
			this.watcher = chokidarModule.default.watch(this.templatesDir, {
				ignored: /^\./,
				persistent: true,
				ignoreInitial: true,
				// The seeds and templates/examples/ (its media/ is not watched).
				depth: 1,
				awaitWriteFinish: {
					stabilityThreshold: 100,
					pollInterval: 50,
				},
			})

			if (this.watcher) {
				this.watcher
					.on('add', async (path: string) => {
						if (this.isSeed(path)) {
							console.log(`📄 Template file added: ${path}`)
							await this.loadTemplate(path)
						}
					})
					.on('change', async (path: string) => {
						if (this.isSeed(path)) {
							console.log(`📝 Template file changed: ${path}`)
							await this.loadTemplate(path)
						}
					})
					.on('unlink', (path: string) => {
						// The library is the database: a seed file that goes away
						// takes nothing with it.
						if (path.endsWith('.json')) {
							console.log(
								`🗑️  Template seed removed (the library keeps it): ${path}`
							)
						}
					})
					.on('error', (error: unknown) => {
						console.error('❌ Template watcher error:', error)
					})
					.on('ready', () => {
						console.log('✅ Template file watcher ready')
					})
			}

			this.isWatching = true
			console.log('👀 Started watching templates directory for changes')
		} catch (error) {
			console.error('❌ Failed to start template watcher:', error)
		}
	}

	/** Load all template files from the templates directory */
	private async loadAllTemplates(): Promise<void> {
		try {
			console.log(`📂 Reading templates from: ${this.templatesDir}`)
			const files = (await readdir(this.templatesDir)) as string[]
			console.log(`📋 Found files: ${files.join(', ')}`)

			const jsonFiles = files.filter((file) => file.endsWith('.json'))
			console.log(`📄 JSON files to load: ${jsonFiles.join(', ')}`)

			for (const file of jsonFiles) {
				const filePath = join(this.templatesDir, file)
				console.log(`🔄 Loading template: ${filePath}`)
				await this.loadTemplate(filePath)
			}
		} catch (error) {
			console.warn(
				`⚠️  Could not read templates directory: ${this.templatesDir}`
			)
			console.error(error)
		}
		const examples = await readdir(this.examplesDir).catch(() => [])
		for (const file of examples.filter((name) => name.endsWith('.json'))) {
			await this.loadTemplate(join(this.examplesDir, file))
		}
	}

	/** The folder of the examples and of their sample media. */
	get examplesDir(): string {
		return join(this.templatesDir, 'examples')
	}

	/** A seed file: a JSON right in templates/ or in templates/examples/. */
	private isSeed(path: string): boolean {
		const folder = resolve(dirname(path))
		return (
			path.endsWith('.json') &&
			(folder === this.templatesDir || folder === this.examplesDir)
		)
	}

	/** The examples still in the library, as the panel groups them. */
	getExamples(): Array<{ name: string; language: string }> {
		return Array.from(this.examples)
			.map((key) => this.templates.get(key))
			.filter((template): template is Template => template !== undefined)
			.map((template) => ({
				name: template.name,
				language: template.language ?? 'en',
			}))
	}

	/**
	 * Import a seed file into the library, unless this very content was
	 * imported before (the API may have changed or deleted it since).
	 */
	private async loadTemplate(filePath: string): Promise<void> {
		try {
			const content = await readFile(filePath, 'utf-8')
			const hash = createHash('sha256').update(content).digest('hex')
			const templateData = JSON.parse(content)

			// Apply defaults and auto-generate variables
			const processedTemplateData = this.processTemplateData(templateData)

			// Validate template structure using JSON schema
			const validationResult = validateTemplateData(processedTemplateData)
			if (!validationResult.isValid) {
				console.error(`❌ Invalid template structure in ${filePath}:`)
				if (validationResult.errors) {
					for (const error of validationResult.errors) {
						console.error(`  - ${error.path}: ${error.message}`)
					}
				}
				return
			}

			const template = validationResult.data as Template
			const templateKey = `${template.name}_${template.language}`
			if (resolve(dirname(filePath)) === this.examplesDir) {
				this.examples.add(templateKey)
			}
			const seeded = this.db
				.query<{ hash: string }, [string, string]>(
					'SELECT hash FROM template_seeds WHERE name = ? AND language = ?'
				)
				.get(template.name, template.language ?? 'en')
			if (seeded?.hash === hash) return

			this.writeRow(template)
			this.db
				.query(
					`INSERT INTO template_seeds (name, language, hash) VALUES (?, ?, ?)
					 ON CONFLICT (name, language) DO UPDATE SET hash = excluded.hash`
				)
				.run(template.name, template.language ?? 'en', hash)

			console.log(`✅ Imported template seed: ${templateKey}`)
		} catch (error) {
			console.error(`❌ Error loading template from ${filePath}:`, error)
		}
	}

	/** Process template data to apply defaults and auto-generate variables */
	private processTemplateData(
		templateData: Partial<Template> & {
			name: string
			components: TemplateComponent[]
		}
	): Template {
		const processed = { ...templateData }

		// Apply default language if not provided
		if (!processed.language) {
			processed.language = 'en'
		}

		// Apply default category if not provided
		if (!processed.category) {
			processed.category = 'UTILITY'
		}

		processed.id = templateIdOf(processed.name, processed.language)

		// Auto-generate variables if not provided or merge with existing
		if (processed.components) {
			const autoGeneratedVariables = generateVariablesFromTemplate(
				processed.components
			)

			if (!processed.variables) {
				// No existing variables, use auto-generated ones
				processed.variables = autoGeneratedVariables
			} else {
				// Merge existing variables with auto-generated ones (existing takes precedence)
				processed.variables = {
					...autoGeneratedVariables,
					...processed.variables,
				}
			}
		}

		return processed
	}

	/** Get template by name and language */
	getTemplate(name: string, language = 'en'): Template | undefined {
		if (this.templateResolver) {
			return this.templateResolver.resolveTemplate(name, language) || undefined
		}

		const key = `${name}_${language}`
		return this.templates.get(key)
	}

	/** The template Meta knows by this id, if the mock has it. */
	getTemplateById(id: string): Template | undefined {
		for (const template of this.templates.values()) {
			if (template.id === id) return template
		}
		return undefined
	}

	/** Get all templates */
	getAllTemplates(): Template[] {
		return Array.from(this.templates.values())
	}

	/** Get templates by category */
	getTemplatesByCategory(category: Template['category']): Template[] {
		return Array.from(this.templates.values()).filter(
			(template) => template.category === category
		)
	}

	/** Get template names for listing */
	getTemplateNames(): string[] {
		return Array.from(this.templates.values()).map((template) => template.name)
	}

	/** Create or replace a template in the library. */
	async upsertTemplate(template: Template): Promise<Template> {
		if (this.templateResolver) {
			throw new Error(
				'This mock resolves the templates with an external command; they are not editable here.'
			)
		}

		const processed = this.processTemplateData(template)
		const validationResult = validateTemplateData(processed)
		if (!validationResult.isValid || !validationResult.data) {
			throw new Error(
				`Invalid template: ${formatValidationErrorForAPI(validationResult.errors ?? [])}`
			)
		}

		const data = validationResult.data as Template
		this.writeRow(data)
		console.log(`💾 Saved template: ${data.name}_${data.language}`)
		return data
	}

	/** Delete a template from the library; its seed file, if any, stays. */
	async removeTemplate(name: string, language = 'en'): Promise<boolean> {
		if (this.templateResolver) {
			throw new Error(
				'This mock resolves the templates with an external command; they are not editable here.'
			)
		}

		const key = `${name}_${language}`
		if (!this.templates.has(key)) return false

		this.db
			.query('DELETE FROM templates WHERE name = ? AND language = ?')
			.run(name, language)
		this.templates.delete(key)
		console.log(`🗑️  Deleted template: ${key}`)
		return true
	}

	/** Get template stats */
	getStats(): {
		totalTemplates: number | string
		templatesByCategory:
			| { MARKETING: number; UTILITY: number; AUTHENTICATION: number }
			| string
		usingCustomResolver: boolean
		isWatching: boolean
		templatesDir: string
		templateKeys: string[] | string
	} {
		if (this.templateResolver) {
			return {
				totalTemplates: 'Using custom resolver',
				templatesByCategory: 'Using custom resolver',
				usingCustomResolver: true,
				isWatching: false,
				templatesDir: this.templatesDir,
				templateKeys: 'Using custom resolver',
			}
		}

		return {
			totalTemplates: this.templates.size,
			templatesByCategory: {
				MARKETING: this.getTemplatesByCategory('MARKETING').length,
				UTILITY: this.getTemplatesByCategory('UTILITY').length,
				AUTHENTICATION: this.getTemplatesByCategory('AUTHENTICATION').length,
			},
			usingCustomResolver: false,
			isWatching: this.isWatching,
			templatesDir: this.templatesDir,
			templateKeys: Array.from(this.templates.keys()),
		}
	}

	/** Read the library again and import the seeds that changed. */
	async reloadTemplates(): Promise<void> {
		console.log('🔄 Manually reloading all templates...')
		this.readLibrary()
		await this.loadAllTemplates()
		console.log(`✅ Manually reloaded ${this.templates.size} templates`)
	}

	/** Clean up resources */
	async cleanup(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close()
			this.isWatching = false
			console.log('🔒 Template watcher stopped')
		}
	}
}

// Export singleton instance
export const templateStore = new TemplateStore()

// Re-export Template type for modules that previously imported it from this file
export type { Template }
