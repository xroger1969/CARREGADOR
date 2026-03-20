const DGEG_BASE_URL = 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PMD';
const REQUEST_TIMEOUT_MS = 8000;

function withTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

function parseEuroNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return NaN;
  const normalized = value.replace(',', '.').trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getDateFromEntry(entry) {
  const candidates = [entry.Data, entry.data, entry.dt, entry.date, entry.DataInicio];
  return candidates.find((value) => typeof value === 'string' && value.length >= 10) || null;
}

function getFuelName(entry) {
  const candidates = [entry.Combustivel, entry.combustivel, entry.Designacao, entry.designacao, entry.TipoCombustivel];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

function getPriceFromEntry(entry) {
  const candidates = [entry.PrecoMedio, entry.precoMedio, entry.Preco, entry.preco, entry.Valor];
  for (const value of candidates) {
    const parsed = parseEuroNumber(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return NaN;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Resposta DGEG inválida.');
  }

  if (Number.isFinite(payload.gasolina95) && Number.isFinite(payload.gasoleoSimples)) {
    return {
      gasolina95: Number(payload.gasolina95),
      gasoleoSimples: Number(payload.gasoleoSimples),
      data: payload.data,
    };
  }

  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.Resultado)
      ? payload.Resultado
      : Array.isArray(payload.resultado)
        ? payload.resultado
        : Array.isArray(payload.Data)
          ? payload.Data
          : [];

  if (entries.length === 0) {
    throw new Error('Sem registos DGEG para processar.');
  }

  let gasolina95 = NaN;
  let gasoleoSimples = NaN;
  let latestDate = null;

  for (const entry of entries) {
    const fuelName = getFuelName(entry).toLowerCase();
    const price = getPriceFromEntry(entry);
    const date = getDateFromEntry(entry);

    if (!latestDate && date) latestDate = date;

    if (Number.isFinite(price) && fuelName.includes('gasolina') && fuelName.includes('95') && !Number.isFinite(gasolina95)) {
      gasolina95 = price;
    }

    if (
      Number.isFinite(price)
      && (fuelName.includes('gasóleo') || fuelName.includes('gasoleo'))
    ) {
      if (!fuelName.includes('especial') && !Number.isFinite(gasoleoSimples)) {
        gasoleoSimples = price;
      }
    }

    if (Number.isFinite(gasolina95) && Number.isFinite(gasoleoSimples)) {
      break;
    }
  }

  if (!Number.isFinite(gasolina95) || !Number.isFinite(gasoleoSimples)) {
    throw new Error('Não foi possível identificar gasolina 95 e gasóleo simples.');
  }

  return {
    gasolina95,
    gasoleoSimples,
    data: typeof latestDate === 'string' ? latestDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

async function fetchDgegData() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${DGEG_BASE_URL}?idsTiposComb=1120,3201&dataInicio=${today}&dataFim=${today}`,
    `${DGEG_BASE_URL}?dataInicio=${today}&dataFim=${today}`,
    DGEG_BASE_URL,
  ];

  let lastError = null;

  for (const url of urls) {
    try {
      const response = await withTimeout(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      return normalizePayload(payload);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Falha a obter dados da DGEG.');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  try {
    const data = await fetchDgegData();
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      gasolina95: Number(data.gasolina95.toFixed(3)),
      gasoleoSimples: Number(data.gasoleoSimples.toFixed(3)),
      fonte: 'DGEG',
      data: data.data,
    });
  } catch (error) {
    res.status(502).json({ error: 'Falha ao obter dados da DGEG.', detalhe: error.message });
  }
}
