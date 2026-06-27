const DGEG_API_URL = 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos';
const REQUEST_TIMEOUT_MS = 9000;
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

function abortSignalWithTimeout(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) };
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

function buildUrl() {
  const params = new URLSearchParams({
    idsTiposComb: `${FUEL_TYPES.gasolina95.id},${FUEL_TYPES.gasoleoSimples.id}`,
    idMarca: '',
    idTipoPosto: '',
    idDistrito: '',
    idsMunicipios: '',
    qtdPorPagina: '10000',
    pagina: '1'
  });
  return `${DGEG_API_URL}?${params.toString()}`;
}

async function fetchDgegPrices() {
  const { signal, cancel } = abortSignalWithTimeout(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(), {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`DGEG HTTP ${response.status}`);
    }

    const payload = await response.json();
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
      fonte: 'DGEG',
      data,
      amostra: {
        gasolina95: gasolinaRows.length,
        gasoleoSimples: gasoleoRows.length
      }
    };
  } finally {
    cancel();
  }
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

  try {
    const prices = await fetchDgegPrices();
    return res.status(200).json(prices);
  } catch (error) {
    console.error('Erro no endpoint /api/precos-combustiveis:', error);
    return res.status(502).json({
      error: 'Falha ao obter preços da DGEG.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}
