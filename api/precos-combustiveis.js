const DGEG_PRECO_MEDIO_URL = 'https://www.dgeg.gov.pt/pt/areas-setoriais/energia/combustiveis/petroleo-e-produtos-derivados/preco-medio-diario/';
const REQUEST_TIMEOUT_MS = 8000;

function abortSignalWithTimeout(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) };
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(html) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parsePriceValue(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(3));
}

function findPriceInRow(html, labelRegex) {
  const rowRegex = new RegExp(`<tr[^>]*>[\\s\\S]*?${labelRegex}[\\s\\S]*?<\\/tr>`, 'i');
  const rowMatch = html.match(rowRegex);
  if (!rowMatch) return null;

  const rowText = stripTags(rowMatch[0]);
  const valueMatch = rowText.match(/(\d{1,2}[.,]\d{2,3})/);
  if (!valueMatch) return null;
  return parsePriceValue(valueMatch[1]);
}

function findPriceNearLabel(text, labelRegex) {
  const searchRegex = new RegExp(`${labelRegex}[^\\d]{0,120}(\\d{1,2}[.,]\\d{2,3})`, 'i');
  const match = text.match(searchRegex);
  if (!match) return null;
  return parsePriceValue(match[1]);
}

function extractPriceFromHtml(html, labels) {
  for (const label of labels) {
    const labelRegex = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const byRow = findPriceInRow(html, labelRegex);
    if (byRow) return byRow;
  }

  const normalizedText = normalizeText(stripTags(html));
  for (const label of labels) {
    const normalizedLabelRegex = normalizeText(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const byNearbyText = findPriceNearLabel(normalizedText, normalizedLabelRegex);
    if (byNearbyText) return byNearbyText;
  }

  return null;
}

function extractReferenceDate(html) {
  const rawText = stripTags(html);

  const isoMatch = rawText.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const ptNumericMatch = rawText.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (ptNumericMatch) {
    const day = ptNumericMatch[1].padStart(2, '0');
    const month = ptNumericMatch[2].padStart(2, '0');
    const year = ptNumericMatch[3];
    return `${year}-${month}-${day}`;
  }

  const months = {
    janeiro: '01', fevereiro: '02', marco: '03', março: '03', abril: '04', maio: '05', junho: '06',
    julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
  };

  const normalizedText = normalizeText(rawText);
  const ptLongMatch = normalizedText.match(/\b(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(20\d{2})\b/i);
  if (ptLongMatch) {
    const day = ptLongMatch[1].padStart(2, '0');
    const month = months[ptLongMatch[2]];
    const year = ptLongMatch[3];
    if (month) return `${year}-${month}-${day}`;
  }

  return null;
}

async function fetchDgegHtml() {
  const { signal, cancel } = abortSignalWithTimeout(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(DGEG_PRECO_MEDIO_URL, {
      method: 'GET',
      signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'user-agent': 'carregador-simulador/1.0 (+https://vercel.com)'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`DGEG HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    cancel();
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const html = await fetchDgegHtml();

    // Estratégia com múltiplos aliases para reduzir fragilidade do parsing.
    const gasolina95 = extractPriceFromHtml(html, ['gasolina simples 95', 'gasolina 95 simples', 'gasolina simples']);
    const gasoleoSimples = extractPriceFromHtml(html, ['gasoleo simples', 'gasóleo simples']);
    const data = extractReferenceDate(html);

    if (!gasolina95 || !gasoleoSimples || !data) {
      throw new Error('Não foi possível extrair gasolina95, gasoleoSimples e data do HTML da DGEG.');
    }

    return res.status(200).json({
      gasolina95,
      gasoleoSimples,
      fonte: 'DGEG',
      data
    });
  } catch (error) {
    console.error('Erro no endpoint /api/precos-combustiveis:', error);
    return res.status(502).json({
      error: 'Falha ao obter preços da DGEG.'
    });
  }
}
