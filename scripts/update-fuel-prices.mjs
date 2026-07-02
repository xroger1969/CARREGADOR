import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';

const DGEG_HOST = 'precoscombustiveis.dgeg.gov.pt';
const DGEG_PATH = '/api/PrecoComb/PesquisarPostos';
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_SIZE = 1000;
const OUTPUT_FILE = path.join('data', 'precos-combustiveis.json');

const DEFAULT_DISTRICT_ID = process.env.DISTRITO_ID || '15'; // Setúbal, inclui Almada.
const DISTRICTS = {
  '01': 'Aveiro',
  '02': 'Beja',
  '03': 'Braga',
  '04': 'Bragança',
  '05': 'Castelo Branco',
  '06': 'Coimbra',
  '07': 'Évora',
  '08': 'Faro',
  '09': 'Guarda',
  '10': 'Leiria',
  '11': 'Lisboa',
  '12': 'Portalegre',
  '13': 'Porto',
  '14': 'Santarém',
  '15': 'Setúbal',
  '16': 'Viana do Castelo',
  '17': 'Vila Real',
  '18': 'Viseu'
};

const FUEL_TYPES = {
  gasolina95: {
    id: '3201',
    labels: ['gasolina simples 95', 'gasolina 95 simples', 'gasolina 95']
  },
  gasoleoSimples: {
    id: '2101',
    labels: ['gasoleo simples', 'gasóleo simples']
  }
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parsePrice(value) {
  if (value === null || value === undefined) return null;

  const parsed = Number.parseFloat(
    String(value)
      .replace('€', '')
      .replace(/\s/g, '')
      .replace(',', '.')
  );

  if (!Number.isFinite(parsed) || parsed <= 0.5 || parsed >= 3.5) return null;
  return parsed;
}

function average(values) {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(3));
}

function getRows(payload) {
  if (Array.isArray(payload?.resultado)) return payload.resultado;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function readField(row, possibleNames) {
  for (const name of possibleNames) {
    if (row && row[name] !== undefined && row[name] !== null) return row[name];
  }
  return '';
}

function matchesFuel(row, fuelConfig) {
  const fuelText = normalizeText(
    readField(row, [
      'Combustivel',
      'TipoCombustivel',
      'DesignacaoCombustivel',
      'NomeCombustivel',
      'Fuel',
      'fuel'
    ])
  );

  if (!fuelText) {
    const fullRowText = normalizeText(JSON.stringify(row));
    return fuelConfig.labels.some(label => fullRowText.includes(normalizeText(label)));
  }

  return fuelConfig.labels.some(label => fuelText.includes(normalizeText(label)));
}

function getPrice(row) {
  return parsePrice(readField(row, ['Preco', 'Preço', 'PVP', 'Valor', 'Price', 'price']));
}

function latestDate(rows) {
  const dates = rows
    .flatMap(row => [
      readField(row, ['DataAtualizacao', 'dataAtualizacao', 'Data', 'data', 'UpdatedAt', 'updated_at']),
      readField(row, ['DataPreco', 'dataPreco'])
    ])
    .map(value => String(value || '').slice(0, 10))
    .filter(value => /^20\d{2}-\d{2}-\d{2}$/.test(value))
    .sort();

  return dates.at(-1) || new Date().toISOString().slice(0, 10);
}

function buildPath(idDistrito, pagina = 1) {
  const params = new URLSearchParams({
    idsTiposComb: `${FUEL_TYPES.gasolina95.id},${FUEL_TYPES.gasoleoSimples.id}`,
    idMarca: '',
    idTipoPosto: '',
    idDistrito,
    idsMunicipios: '',
    qtdPorPagina: String(PAGE_SIZE),
    pagina: String(pagina)
  });

  return `${DGEG_PATH}?${params.toString()}`;
}

function getJsonFromDgeg(requestPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: DGEG_HOST,
        path: requestPath,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'carregador-github-action/1.0 (+https://github.com/xroger1969/CARREGADOR)'
        }
      },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`DGEG HTTP ${response.statusCode}: ${body.slice(0, 180)}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Resposta DGEG não é JSON: ${body.slice(0, 180)}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao contactar a DGEG.'));
    });

    req.on('error', reject);
  });
}

async function fetchRows(idDistrito) {
  const allRows = [];

  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const payload = await getJsonFromDgeg(buildPath(idDistrito, pagina));
    const rows = getRows(payload);

    if (!rows.length) break;
    allRows.push(...rows);

    const totalPages = Number(
      payload?.totalPaginas ||
        payload?.TotalPaginas ||
        payload?.totalPages ||
        payload?.TotalPages ||
        0
    );

    if (totalPages && pagina >= totalPages) break;
    if (rows.length < PAGE_SIZE) break;
  }

  return allRows;
}

function extractPrices(rows, idDistrito) {
  if (!rows.length) {
    throw new Error('A DGEG não devolveu resultados.');
  }

  const gasolinaRows = rows.filter(row => matchesFuel(row, FUEL_TYPES.gasolina95));
  const gasoleoRows = rows.filter(row => matchesFuel(row, FUEL_TYPES.gasoleoSimples));

  const gasolinaPrices = gasolinaRows.map(getPrice).filter(Number.isFinite);
  const gasoleoPrices = gasoleoRows.map(getPrice).filter(Number.isFinite);

  const gasolina95 = average(gasolinaPrices);
  const gasoleoSimples = average(gasoleoPrices);

  if (!gasolina95 || !gasoleoSimples) {
    throw new Error(
      `Não foi possível calcular médias. Amostras: gasolina=${gasolinaPrices.length}, gasóleo=${gasoleoPrices.length}.`
    );
  }

  return {
    gasolina95,
    gasoleoSimples,
    data: latestDate(rows),
    fonte: `DGEG (${DISTRICTS[idDistrito] || `distrito ${idDistrito}`})`,
    distrito: idDistrito,
    atualizadoEm: new Date().toISOString(),
    amostra: {
      gasolina95: gasolinaPrices.length,
      gasoleoSimples: gasoleoPrices.length
    }
  };
}

async function main() {
  const idDistrito = DISTRICTS[DEFAULT_DISTRICT_ID] ? DEFAULT_DISTRICT_ID : '15';
  const rows = await fetchRows(idDistrito);
  const prices = extractPrices(rows, idDistrito);

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(`${OUTPUT_FILE}.tmp`, `${JSON.stringify(prices, null, 2)}\n`, 'utf8');
  await fs.rename(`${OUTPUT_FILE}.tmp`, OUTPUT_FILE);

  console.log(
    `Preços atualizados: gasolina95=${prices.gasolina95}, gasoleoSimples=${prices.gasoleoSimples}, data=${prices.data}, fonte=${prices.fonte}`
  );
}

main().catch(error => {
  console.error('Falha ao atualizar preços dos combustíveis:', error);
  process.exitCode = 1;
});
