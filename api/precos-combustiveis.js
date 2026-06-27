import https from 'node:https';

const DGEG_HOST = 'precoscombustiveis.dgeg.gov.pt';
const DGEG_PATH = '/api/PrecoComb/PesquisarPostos';
const REQUEST_TIMEOUT_MS = 9000;
const DEFAULT_DISTRICT_ID = '15'; // Setúbal, inclui Almada.
const DISTRICTS = {
  '11': 'Lisboa',
  '15': 'Setúbal'
};
const FUEL_TYPES = {
  gasolina95: {
    id: '3201',
    labels: ['gasolina simples 95']
  },
  gasoleoSimples: {
    id: '2101',
    labels: ['gasoleo simples', 'gasóleo simples']
  }
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

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
  const cleaned = String(value)
    .replace('€', '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function average(values) {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(3));
}

function matchesFuel(row, fuelConfig) {
  const text = normalizeText(row.Combustivel || row.TipoCombustivel || row.Fuel || '');
  return fuelConfig.labels.some(label => text.includes(normalizeText(label)));
}

function latestDate(rows) {
  const dates = rows
    .map(row => String(row.DataAtualizacao || row.dataAtualizacao || '').slice(0, 10))
    .filter(value => /^20\d{2}-\d{2}-\d{2}$/.test(value))
    .sort();
  return dates[dates.length - 1] || null;
}

function buildPath(idDistrito) {
  const params = new URLSearchParams({
    idsTiposComb: `${FUEL_TYPES.gasolina95.id},${FUEL_TYPES.gasoleoSimples.id}`,
    idMarca: '',
    idTipoPosto: '',
    idDistrito,
    idsMunicipios: '',
    qtdPorPagina: '1000',
    pagina: '1'
  });
  return `${DGEG_PATH}?${params.toString()}`;
}

function getJsonFromDgeg(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: DGEG_HOST,
        path,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'carregador-simulador/1.0'
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
            reject(new Error(`DGEG HTTP ${response.statusCode}: ${body.slice(0, 120)}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Resposta DGEG não é JSON: ${body.slice(0, 120)}`));
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

function extractPrices(payload) {
  const rows = Array.isArray(payload?.resultado) ? payload.resultado : [];

  if (!rows.length) {
    throw new Error('A DGEG não devolveu resultados.');
  }

  const gasolinaRows = rows.filter(row => matchesFuel(row, FUEL_TYPES.gasolina95));
  const gasoleoRows = rows.filter(row => matchesFuel(row, FUEL_TYPES.gasoleoSimples));

  const gasolina95 = average(gasolinaRows.map(row => parsePrice(row.Preco)).filter(Number.isFinite));
  const gasoleoSimples = average(gasoleoRows.map(row => parsePrice(row.Preco)).filter(Number.isFinite));
  const data = latestDate(rows);

  if (!gasolina95 || !gasoleoSimples || !data) {
    throw new Error('Não foi possível calcular gasolina95, gasoleoSimples e data a partir da resposta da DGEG.');
  }

  return {
    gasolina95,
    gasoleoSimples,
    data,
    amostra: {
      gasolina95: gasolinaRows.length,
      gasoleoSimples: gasoleoRows.length
    }
  };
}

async function fetchDgegPrices(idDistrito) {
  const payload = await getJsonFromDgeg(buildPath(idDistrito));
  const prices = extractPrices(payload);

  return {
    ...prices,
    fonte: `DGEG${DISTRICTS[idDistrito] ? ` (${DISTRICTS[idDistrito]})` : ''}`,
    distrito: idDistrito
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const requestedDistrict = String(req.query?.idDistrito || DEFAULT_DISTRICT_ID);
  const idDistrito = DISTRICTS[requestedDistrict] ? requestedDistrict : DEFAULT_DISTRICT_ID;

  try {
    const prices = await fetchDgegPrices(idDistrito);
    return res.status(200).json(prices);
  } catch (error) {
    console.error('Erro no endpoint /api/precos-combustiveis:', error);
    return res.status(502).json({
      error: 'Falha ao obter preços da DGEG.',
      detail: error instanceof Error ? error.message : String(error),
      distrito: idDistrito
    });
  }
}
