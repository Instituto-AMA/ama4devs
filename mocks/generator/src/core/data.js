// @ts-check
/**
 * The real Brazilian data behind the generator: names, streets, cities, banks
 * and CNAE activities. Every list is frozen, so no consumer can change it.
 */

/**
 * @typedef {object} City
 * @property {string} city The city name.
 * @property {string} state The two-letter state code.
 * @property {string} ibge The seven-digit IBGE municipality code.
 * @property {readonly [number, number]} cep The first five CEP digits, as a range.
 * @property {readonly string[]} ddd The area codes of the city.
 */

/**
 * @typedef {object} Activity
 * @property {string} cnae The CNAE code.
 * @property {string} description What the CNAE describes.
 * @property {readonly string[]} products Charge descriptions of the activity.
 */

/**
 * @typedef {object} Bank
 * @property {string} code The three-digit bank code.
 * @property {string} name The bank name.
 * @property {string} ispb The eight-digit ISPB code.
 */

/** Real Brazilian male names, the most common ones first. */
export const MALE_FIRST_NAMES = Object.freeze([
  'João', 'José', 'Antônio', 'Francisco', 'Carlos', 'Paulo', 'Pedro', 'Lucas',
  'Mateus', 'Gabriel', 'Rafael', 'Daniel', 'Marcelo', 'Bruno', 'Eduardo', 'Felipe',
  'Gustavo', 'Leonardo', 'Ricardo', 'Fernando', 'Roberto', 'Marcos', 'Rodrigo', 'Fábio',
  'Sérgio', 'Jorge', 'Álvaro', 'Diego', 'Thiago', 'Vinícius', 'André', 'Renato',
  'Alexandre', 'Luciano', 'Tiago', 'Anderson', 'Cristiano', 'Leandro', 'Luiz', 'Wesley',
  'Matheus', 'Murilo', 'Igor', 'Heitor', 'Otávio', 'Aurélio', 'Célio', 'Éder',
  'Érico', 'Gilmar', 'Helder', 'Ícaro', 'Josué', 'Laércio', 'Maurício', 'Nilton',
  'Oberdan', 'Plínio', 'Reinaldo', 'Sebastião', 'Uriel', 'Vítor', 'Werley', 'Ademir',
  'Arnaldo', 'Benício', 'Cleber', 'Dárcio', 'Elísio', 'Guilherme', 'Hugo', 'Ivan',
  'Joaquim', 'Kléber', 'Luís', 'Mikael', 'Nilson', 'Oswaldo', 'Perseu', 'Rinaldo',
  'Sandro', 'Valdir', 'Willian', 'Xavier',
])

/** Real Brazilian female names, the most common ones first. */
export const FEMALE_FIRST_NAMES = Object.freeze([
  'Maria', 'Ana', 'Francisca', 'Antônia', 'Juliana', 'Márcia', 'Beatriz', 'Sandra',
  'Camila', 'Amanda', 'Jéssica', 'Letícia', 'Júlia', 'Bruna', 'Luciana', 'Vanessa',
  'Patrícia', 'Adriana', 'Natália', 'Cristiane', 'Denise', 'Fabiana', 'Priscila', 'Joana',
  'Rosana', 'Simone', 'Renata', 'Larissa', 'Lívia', 'Tatiana', 'Fernanda', 'Cristiana',
  'Débora', 'Tatiane', 'Mônica', 'Aline', 'Cláudia', 'Daniela', 'Eduarda', 'Eliane',
  'Érika', 'Fátima', 'Gabriela', 'Helena', 'Ingrid', 'Isabela', 'Josiane', 'Jussara',
  'Karina', 'Lorena', 'Luana', 'Luíza', 'Manuela', 'Mara', 'Marina', 'Marisa',
  'Michele', 'Mirian', 'Nair', 'Nara', 'Neusa', 'Nilza', 'Rafaela', 'Regina',
  'Rosângela', 'Rosa', 'Sabina', 'Sara', 'Selma', 'Silvana', 'Sílvia', 'Sofia',
  'Solange', 'Sônia', 'Tânia', 'Thaís', 'Valéria', 'Vera', 'Verônica', 'Viviane',
  'Wanda', 'Zilda', 'Zuleica',
])

/** Real Brazilian family names. */
export const LAST_NAMES = Object.freeze([
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Ferreira', 'Alves',
  'Rodrigues', 'Ribeiro', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira',
  'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques',
  'Machado', 'Mendes', 'Freitas', 'Cardoso', 'Ramos', 'Gonçalves', 'Santana', 'Teixeira',
  'Correia', 'Azevedo', 'Pinto', 'Cunha', 'Moura', 'Baptista', 'Pinheiro', 'Farias',
  'Assunção', 'Queirós', 'Guimarães', 'Castro', 'Campos', 'Cavalcanti', 'Peixoto', 'Albuquerque',
  'Aguiar', 'Meireles', 'Sampaio', 'Valadares', 'Rezende', 'Bittencourt', 'Bragança', 'Camargo',
  'Monteiro', 'Siqueira', 'Tavares', 'Vilhena', 'Xavier', 'Zanon', 'Alcântara', 'Apolinário',
  'Arcoverde', 'Bandeira', 'Espíndola', 'Fontes', 'Girão', 'Lacerda', 'Lousada', 'Maciel',
  'Mascarenhas', 'Noronha', 'Padilha', 'Queiroz', 'Rabelo', 'Salles', 'Tolentino', 'Uchoa',
])

/** The street types a Brazilian address uses. */
export const STREET_TYPES = Object.freeze([
  'Rua', 'Avenida', 'Travessa', 'Alameda', 'Estrada', 'Marginal', 'Rodovia', 'Via',
])

/** Real street names, without the type in front. */
export const STREET_NAMES = Object.freeze([
  'Sete de Setembro', 'Tiradentes', 'Dom Pedro II', 'das Flores', 'XV de Novembro',
  'Getúlio Vargas', 'Minas Gerais', 'Bahia', 'Paraná', 'Rio Grande do Sul',
  'Santa Catarina', 'Goiás', 'Ceará', 'Amazonas', 'Pernambuco', 'Marechal Deodoro',
  'Presidente Vargas', 'General Osório', 'Artur da Távora', 'Primeiro de Maio',
  'Vinte e Quatro de Maio', 'Rodrigues Alves', 'Padre Cícero', 'Santos Dumont',
  'Alberto Torres', 'Regente Feijó', 'Plínio Salgado', 'Ruy Barbosa', 'Barão de Mauá',
  'Benjamin Constant', 'Quinze de Novembro', 'Dezenove de Maio', 'São João',
  'Santa Clara', 'São Pedro', 'São Paulo', 'das Palmeiras', 'das Acácias',
  'dos Girassóis', 'do Comércio', 'dos Andradas', 'São José', 'Santa Luzia',
  'Santana', 'São Roque', 'Boa Vista', 'das Oliveiras', 'dos Ipês', 'do Parque',
  'das Violetas', 'Rio Branco', 'das Itaúbas', 'do Carmo', 'da Matriz',
  'São Sebastião', 'Santa Rita', 'São Francisco', 'das Mangueiras', 'dos Lírios',
  'da Independência', 'do Sol', 'das Marías', 'Nova', 'Dos Campos', 'das Bromélias',
])

/** Real district names, the ones a Brazilian address uses. */
export const DISTRICTS = Object.freeze([
  'Centro', 'Jardim América', 'Vila Mariana', 'Boa Vista', 'Jardim Paulista',
  'Higienópolis', 'Bela Vista', 'Jardins', 'Vila Madalena', 'Moema',
  'Itaim Bibi', 'Pinheiros', 'Perdizes', 'Lapa', 'Santa Cecília', 'Tatuapé',
  'Mooca', 'Santana', 'Vila Olímpia', 'Butantã', 'Brooklin', 'Campo Belo',
  'Santo Amaro', 'Vila Maria', 'Casa Verde', 'Sacomã', 'Tremembé', 'Pirituba',
  'Água Branca', 'Barra Funda', 'Cambuci', 'Consolação', 'República', 'Liberdade',
  'Brás', 'Bixiga', 'Vila Prudente', 'Saúde', 'Vila Conceição', 'Campo Grande',
  'Ipiranga', 'Parque Industrial', 'Jardim Botânico', 'Vila Nova', 'Jardim das Palmeiras',
  'Residencial', 'Novo Horizonte', 'Vila Esperança', 'Cidade Jardim', 'Patriotismo',
  'Alto da Lapa', 'Jardim das Acácias', 'Santa Terezinha', 'Vila Medeiros',
])

/**
 * @typedef {{ [state: string]: string }} StateMap
 */

/**
 * The 27 Brazilian states, by their two-letter code.
 * @type {StateMap}
 */
const STATE_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará',
  PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
}

/** The 27 Brazilian states, by their two-letter code. */
export const STATES = Object.freeze(STATE_NAMES)

/** @type {readonly City[]} */
const CITY_LIST = [
  { city: 'São Paulo', state: 'SP', ibge: '3550308', cep: [1000, 5999], ddd: ['11'] },
  { city: 'Guarulhos', state: 'SP', ibge: '3518800', cep: [7000, 7199], ddd: ['11'] },
  { city: 'Campinas', state: 'SP', ibge: '3509502', cep: [13000, 13999], ddd: ['19'] },
  { city: 'Santos', state: 'SP', ibge: '3548500', cep: [11000, 11999], ddd: ['13'] },
  { city: 'Ribeirão Preto', state: 'SP', ibge: '3543402', cep: [14000, 14999], ddd: ['16'] },
  { city: 'Rio de Janeiro', state: 'RJ', ibge: '3304557', cep: [20000, 23799], ddd: ['21'] },
  { city: 'São Gonçalo', state: 'RJ', ibge: '3304904', cep: [24400, 24999], ddd: ['21'] },
  { city: 'Niterói', state: 'RJ', ibge: '3303302', cep: [24000, 24399], ddd: ['21'] },
  { city: 'Belo Horizonte', state: 'MG', ibge: '3106200', cep: [30000, 31999], ddd: ['31'] },
  { city: 'Contagem', state: 'MG', ibge: '3118601', cep: [32300, 32999], ddd: ['31'] },
  { city: 'Uberlândia', state: 'MG', ibge: '3170206', cep: [38400, 38499], ddd: ['34'] },
  { city: 'Juiz de Fora', state: 'MG', ibge: '3136702', cep: [36000, 36999], ddd: ['32'] },
  { city: 'Montes Claros', state: 'MG', ibge: '3143302', cep: [39400, 39499], ddd: ['38'] },
  { city: 'Salvador', state: 'BA', ibge: '2927408', cep: [40000, 42599], ddd: ['71'] },
  { city: 'Feira de Santana', state: 'BA', ibge: '2910800', cep: [42600, 42999], ddd: ['75'] },
  { city: 'Fortaleza', state: 'CE', ibge: '2304400', cep: [60000, 61599], ddd: ['85'] },
  { city: 'Recife', state: 'PE', ibge: '2611606', cep: [50000, 52999], ddd: ['81'] },
  { city: 'Jaboatão dos Guararapes', state: 'PE', ibge: '2607901', cep: [53400, 53999], ddd: ['81'] },
  { city: 'João Pessoa', state: 'PB', ibge: '2507507', cep: [58000, 58999], ddd: ['83'] },
  { city: 'Natal', state: 'RN', ibge: '2408102', cep: [59000, 59999], ddd: ['84'] },
  { city: 'Maceió', state: 'AL', ibge: '2704302', cep: [57000, 57999], ddd: ['82'] },
  { city: 'Aracaju', state: 'SE', ibge: '2800308', cep: [49000, 49999], ddd: ['79'] },
  { city: 'São Luís', state: 'MA', ibge: '2111300', cep: [65000, 65999], ddd: ['98'] },
  { city: 'Imperatriz', state: 'MA', ibge: '2105302', cep: [65900, 65999], ddd: ['99'] },
  { city: 'Teresina', state: 'PI', ibge: '2211001', cep: [64000, 64999], ddd: ['86'] },
  { city: 'Belém', state: 'PA', ibge: '1501402', cep: [66000, 66999], ddd: ['91'] },
  { city: 'Santarém', state: 'PA', ibge: '1506807', cep: [68800, 68899], ddd: ['93'] },
  { city: 'Macapá', state: 'AP', ibge: '1600303', cep: [68900, 68999], ddd: ['96'] },
  { city: 'Manaus', state: 'AM', ibge: '1302603', cep: [69000, 69099], ddd: ['92'] },
  { city: 'Boa Vista', state: 'RR', ibge: '1400100', cep: [69300, 69399], ddd: ['95'] },
  { city: 'Porto Velho', state: 'RO', ibge: '1100205', cep: [76800, 76999], ddd: ['69'] },
  { city: 'Rio Branco', state: 'AC', ibge: '1200401', cep: [69900, 69999], ddd: ['61'] },
  { city: 'Brasília', state: 'DF', ibge: '5300108', cep: [70000, 73699], ddd: ['61'] },
  { city: 'Goiânia', state: 'GO', ibge: '5208707', cep: [74000, 76999], ddd: ['62'] },
  { city: 'Rio Verde', state: 'GO', ibge: '5218805', cep: [75900, 75999], ddd: ['64'] },
  { city: 'Campo Grande', state: 'MS', ibge: '5002704', cep: [79000, 79999], ddd: ['67'] },
  { city: 'Cuiabá', state: 'MT', ibge: '5103403', cep: [78000, 78999], ddd: ['65'] },
  { city: 'Várzea Grande', state: 'MT', ibge: '5108402', cep: [78100, 78299], ddd: ['65'] },
  { city: 'Palmas', state: 'TO', ibge: '1721000', cep: [77000, 77999], ddd: ['63'] },
  { city: 'Curitiba', state: 'PR', ibge: '4106902', cep: [80000, 82999], ddd: ['41'] },
  { city: 'Londrina', state: 'PR', ibge: '4113700', cep: [86000, 86999], ddd: ['43'] },
  { city: 'Maringá', state: 'PR', ibge: '4115200', cep: [87000, 87999], ddd: ['44'] },
  { city: 'Florianópolis', state: 'SC', ibge: '4205407', cep: [88000, 88999], ddd: ['48'] },
  { city: 'Joinville', state: 'SC', ibge: '4209102', cep: [89000, 89999], ddd: ['47'] },
  { city: 'Blumenau', state: 'SC', ibge: '4202404', cep: [89000, 89299], ddd: ['47'] },
  { city: 'Porto Alegre', state: 'RS', ibge: '4314902', cep: [90000, 91999], ddd: ['51'] },
  { city: 'Pelotas', state: 'RS', ibge: '4314407', cep: [96000, 96999], ddd: ['53'] },
  { city: 'Caxias do Sul', state: 'RS', ibge: '4305108', cep: [95000, 95999], ddd: ['54'] },
  { city: 'Vitória', state: 'ES', ibge: '3205309', cep: [29000, 29999], ddd: ['28'] },
  { city: 'Vila Velha', state: 'ES', ibge: '3205200', cep: [29100, 29299], ddd: ['28'] },
]

/** The real cities, each with its IBGE code, CEP range and area codes. */
export const CITIES = Object.freeze(CITY_LIST.map((city) => Object.freeze(city)))

/** The words a company name is built from. */
export const COMPANY_WORDS = Object.freeze([
  'Aurora', 'Horizonte', 'Alfa', 'Prisma', 'Central', 'União', 'Forte', 'Órion',
  'Vital', 'Nova', 'Atlas', 'Boreal', 'Cristal', 'Delta', 'Estrela', 'Farol',
  'Íris', 'Júpiter', 'Lumina', 'Meridiano', 'Nébula', 'Opala', 'Quartzo', 'Rubi',
  'Solar', 'Titan', 'Ubatã', 'Valle', 'Zênite', 'Aroeira', 'Bandeirante', 'Cedro',
  'Dourada', 'Estreito', 'Fênix', 'Girassol', 'Ítaca', 'Jacarandá', 'Lótus', 'Nimbus',
  'Oceano', 'Sirius', 'Tamoio', 'Urano', 'Vitória', 'Xingu', 'Zafira', 'Âmbar',
])

/** The legal forms a Brazilian company takes. */
export const COMPANY_SUFFIXES = Object.freeze(['Ltda', 'S.A.', 'ME', 'EPP', 'SLU'])

/** @type {readonly Activity[]} */
const ACTIVITY_LIST = [
  {
    cnae: '6201-5/01',
    description: 'Desenvolvimento de programas de computador sob encomenda',
    products: ['Mensalidade do plano Pro', 'Desenvolvimento de software sob medida', 'Suporte técnico mensal', 'Horas de desenvolvimento'],
  },
  {
    cnae: '7020-2/00',
    description: 'Consultoria em tecnologia da informação',
    products: ['Consultoria de TI', 'Planejamento de sistemas', 'Auditoria de infraestrutura', 'Homologação de software'],
  },
  {
    cnae: '6319-4/00',
    description: 'Portais, provedoria de internet e ferramental de busca',
    products: ['Assinatura mensal do portal', 'Tráfego adicional', 'Indexação de páginas', 'Painel de métricas'],
  },
  {
    cnae: '6312-3/00',
    description: 'Portais de internet e mídias sociais',
    products: ['Gestão de redes sociais', 'Produção de conteúdo', 'Anúncio patrocinado', 'Campanha mensal'],
  },
  {
    cnae: '5820-1/00',
    description: 'Portais, redes sociais e serviços de compartilhamento de conteúdo',
    products: ['Plano de compartilhamento', 'Armazenamento extra', 'Publicação patrocinada', 'Assinatura premium'],
  },
  {
    cnae: '6020-2/00',
    description: 'Programação e transmissão de conteúdo de rádio e televisão',
    products: ['Espaço publicitário', 'Transmissão ao vivo', 'Patrocínio de programa', 'Produção de vinheta'],
  },
  {
    cnae: '8299-7/99',
    description: 'Atividades de serviços de informação não especificadas anteriormente',
    products: ['Consulta de dados', 'Relatório de informações', 'Assinatura do serviço', 'Pesquisa sob demanda'],
  },
  {
    cnae: '4711-7/03',
    description: 'Lojas de varejo de calçados',
    products: ['Tênis masculino', 'Sapatilha feminina', 'Coturno', 'Palmilha de reposição'],
  },
  {
    cnae: '4763-6/01',
    description: 'Comércio varejista de brinquedos e brinquedos educativos',
    products: ['Quebra-cabeça 100 peças', 'Jogo de tabuleiro', 'Boneca articulada', 'Kit de blocos'],
  },
  {
    cnae: '4729-6/99',
    description: 'Comércio varejista de outros produtos não especificados anteriormente',
    products: ['Produto assorted', 'Kit presente', 'Item de capricho', 'Caixa surpresa'],
  },
  {
    cnae: '4721-7/00',
    description: 'Comércio varejista de produtos de panificação',
    products: ['Pão francês', 'Bolo de milho', 'Torrada artesanal', 'Pão de queijo'],
  },
  {
    cnae: '4781-4/00',
    description: 'Comércio varejista de artigos do vestuário',
    products: ['Camiseta de algodão', 'Calça jeans', 'Jaqueta de inverno', 'Vestido floral'],
  },
  {
    cnae: '5611-2/01',
    description: 'Restaurantes',
    products: ['Almoço por quilo', 'Pizza margherita', 'Suco natural 300ml', 'Prato feito do dia'],
  },
  {
    cnae: '5611-2/03',
    description: 'Lanchonetes',
    products: ['Lanche natural', 'Salgado assado', 'Sanduíche gourmet', 'Café expresso'],
  },
  {
    cnae: '5612-1/00',
    description: 'Serviços de catering',
    products: ['Coffee break', 'Almoço para evento', 'Mesa de doces', 'Serviço de copeiro'],
  },
  {
    cnae: '8599-6/03',
    description: 'Treinamento em desenvolvimento profissional e gerencial',
    products: ['Curso de liderança', 'Workshop de gestão', 'Mentoria individual', 'Trilha de carreira'],
  },
  {
    cnae: '8599-6/04',
    description: 'Treinamento em desenvolvimento profissional',
    products: ['Pacote de 10 aulas', 'Workshop corporativo', 'Certificação profissional', 'Aula prática'],
  },
  {
    cnae: '8599-6/99',
    description: 'Outras atividades de ensino não especificadas anteriormente',
    products: ['Aula particular', 'Material didático', 'Turma de fundamentos', 'Avaliação de desempenho'],
  },
  {
    cnae: '8512-1/00',
    description: 'Educação infantil — creches e pré-escolas',
    products: ['Mensalidade da creche', 'Atividade extracurricular', 'Refeição incluída', 'Kit de material escolar'],
  },
  {
    cnae: '8630-5/01',
    description: 'Atividade médica ambulatorial restrita a consultas',
    products: ['Consulta médica', 'Retorno em 15 dias', 'Exame de rotina', 'Acompanhamento mensal'],
  },
  {
    cnae: '8630-5/04',
    description: 'Atividade odontológica',
    products: ['Consulta odontológica', 'Limpeza dental', 'Tratamento de canal', 'Obturação'],
  },
  {
    cnae: '8690-9/99',
    description: 'Atividades de cuidados de saúde não especificadas anteriormente',
    products: ['Sessão de fisioterapia', 'Sessão de psicologia', 'Avaliação inicial', 'Plano de acompanhamento'],
  },
  {
    cnae: '6920-6/01',
    description: 'Atividades de contabilidade',
    products: ['Mensalidade contábil', 'Declaração de imposto de renda', 'Consultoria financeira', 'Escrituração'],
  },
  {
    cnae: '6910-6/02',
    description: 'Atividades de cartório',
    products: ['Certidão de nascimento', 'Reconhecimento de firma', 'Autenticação de cópia', 'Certidão de casamento'],
  },
  {
    cnae: '7120-1/00',
    description: 'Testes e ensaios de análise técnica',
    products: ['Laudo de ensaio', 'Teste de carga', 'Análise de material', 'Certificado de qualidade'],
  },
  {
    cnae: '8121-4/00',
    description: 'Limpeza em prédios e em domicílios',
    products: ['Limpeza de apartamento', 'Limpeza de escritório', 'Higienização de estofados', 'Diarista por dia'],
  },
  {
    cnae: '4120-4/01',
    description: 'Construção de edifícios residenciais',
    products: ['Projeto residencial', 'Obra por empreitada', 'Reforma de cobertura', 'Vistoria de obra'],
  },
  {
    cnae: '2369-1/00',
    description: 'Obras de fundações e contenções',
    products: ['Estaqueamento', 'Cortina de contenção', 'Fundação rasa', 'Laudo de solo'],
  },
  {
    cnae: '4941-7/00',
    description: 'Transporte rodoviário de cargas',
    products: ['Frete por quilômetro', 'Transferência de carga', 'Frete por distância', 'Tonelada transportada'],
  },
  {
    cnae: '5320-4/00',
    description: 'Atividades de entregas',
    products: ['Entrega por aplicativo', 'Frete de encomenda', 'Entrega expressa', 'Coleta agendada'],
  },
  {
    cnae: '6820-6/02',
    description: 'Comércio varejista de imóveis',
    products: ['Avaliação de imóvel', 'Anúncio de venda', 'Administração de locação', 'Taxa de intermediação'],
  },
  {
    cnae: '7410-2/00',
    description: 'Atividades de design',
    products: ['Criação de logomarca', 'Identidade visual', 'Design de embalagem', 'Manual de marca'],
  },
  {
    cnae: '7311-2/00',
    description: 'Atividades de publicidade e propaganda',
    products: ['Campanha publicitária', 'Peça publicitária', 'Patrocínio de evento', 'Plano de mídia'],
  },
  {
    cnae: '9001-9/01',
    description: 'Atividades de gravação de som',
    products: ['Gravação de podcast', 'Trilha sonora', 'Mixagem e masterização', 'Sessão de voz'],
  },
  {
    cnae: '7420-0/01',
    description: 'Atividades de produção de fotografias',
    products: ['Ensaio fotográfico', 'Fotografia de produto', 'Cobertura de evento', 'Retoque de imagem'],
  },
]

/** The CNAE activities, each with the products a charge can describe. */
export const ACTIVITIES = Object.freeze(ACTIVITY_LIST.map((activity) => Object.freeze(activity)))

/** The only e-mail domains a generated address may use. */
export const EMAIL_DOMAINS = Object.freeze(['example.com', 'example.org', 'example.net'])

/** @type {readonly Bank[]} */
const BANK_LIST = [
  { code: '001', name: 'Banco do Brasil', ispb: '00000000' },
  { code: '033', name: 'Banco Santander S.A.', ispb: '90400888' },
  { code: '104', name: 'Caixa Econômica Federal', ispb: '00360305' },
  { code: '237', name: 'Banco Bradesco S.A.', ispb: '60746948' },
  { code: '341', name: 'Banco Itaú S.A.', ispb: '60701190' },
  { code: '260', name: 'Nu Pagamentos S.A.', ispb: '18236120' },
  { code: '077', name: 'Banco Inter S.A.', ispb: '00416968' },
  { code: '336', name: 'C6 Bank S.A.', ispb: '31872495' },
  { code: '212', name: 'Banco Original S.A.', ispb: '92894922' },
  { code: '756', name: 'Banco Cooperativo do Brasil S.A.', ispb: '02038232' },
  { code: '748', name: 'Cooperativa de Crédito Rural', ispb: '01181521' },
  { code: '290', name: 'PagSeguro Digital S.A.', ispb: '08561701' },
  { code: '380', name: 'PicPay Instituição de Pagamento S.A.', ispb: '22896431' },
  { code: '323', name: 'Mercado Pago Instituição de Pagamento S.A.', ispb: '10573521' },
]

/** The real banks, with their code and ISPB. */
export const BANKS = Object.freeze(BANK_LIST.map((bank) => Object.freeze(bank)))

/**
 * A URL-safe slug: accents removed, lower case, everything else a dash.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The area codes of a city, looked up by name and state.
 * @param {string} cityName
 * @param {string} state
 * @returns {readonly string[]}
 */
export function dddFor(cityName, state) {
  const found = CITIES.find((city) => city.city === cityName && city.state === state)
  return found ? found.ddd : ['11']
}
