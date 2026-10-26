/**
 * Compiles the CLI and server into one self-contained executable (dist/whap).
 *
 * ink imports `react-devtools-core` from a module it loads only when DEV=true.
 * The bundler still resolves that import, and the package is not a dependency,
 * so the plugin below answers it with an empty module: the compiled binary has
 * no devtools, which the mock never uses.
 */
import type { BunPlugin } from 'bun'

const noInkDevtools: BunPlugin = {
	name: 'no-ink-devtools',
	setup(build) {
		build.onResolve({ filter: /^react-devtools-core$/ }, (args) => ({
			path: args.path,
			namespace: 'ink-devtools-stub',
		}))
		build.onLoad({ filter: /.*/, namespace: 'ink-devtools-stub' }, () => ({
			contents: 'export default { connectToDevTools() {} }',
			loader: 'js',
		}))
	},
}

const result = await Bun.build({
	entrypoints: ['src/index.ts'],
	compile: { outfile: 'dist/whap' },
	plugins: [noInkDevtools],
})

if (!result.success) {
	for (const log of result.logs) console.error(log)
	process.exit(1)
}
