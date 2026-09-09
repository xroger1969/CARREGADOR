from pathlib import Path
import re

path = Path('index.html')
text = path.read_text(encoding='utf-8')

text = text.replace('<h2>3. Resultados finais</h2>', '<h2>3. Comparação de custos</h2>', 1)

old_css = """    .result{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .box{border:1px solid #dbe5f4;border-radius:14px;background:#f8fbff;padding:12px}
    .big{font-size:1.25rem;font-weight:900}
"""
new_css = """    .result{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .box{border:1px solid #dbe5f4;border-radius:14px;background:#f8fbff;padding:12px}
    .big{font-size:1.25rem;font-weight:900}
    .comparison-title{text-align:center;font-size:1.08rem;color:#475569;margin:2px 0 14px}
    .comparison-title strong{color:#0f172a;font-size:1.2rem}
    .comparison-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}
    .compare-card{border:2px solid #dbe5f4;border-radius:18px;padding:18px;text-align:center}
    .compare-card.electric{background:#ecfdf5;border-color:#86efac}
    .compare-card.fuel{background:#fff7ed;border-color:#fdba74}
    .compare-label{font-weight:800;font-size:1.05rem;margin-bottom:6px}
    .compare-value{font-size:clamp(2rem,5vw,2.8rem);line-height:1;font-weight:950;color:#0f172a;margin:8px 0}
    .compare-sub{color:#64748b;font-size:.95rem}
    .savings-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:16px;padding:15px 18px;margin:0 0 18px}
    .savings-main{font-size:1.12rem;font-weight:800;color:#0f172a}
    .savings-main strong{font-size:1.45rem;color:#166534}
    .savings-percent{font-weight:800;color:#1d4ed8;text-align:right}
    .details-title{font-weight:800;color:#475569;margin:4px 0 9px}
    .details-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .detail-box{border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:11px 12px}
    .detail-label{color:#64748b;font-size:.9rem;margin-bottom:3px}
    .detail-value{font-weight:900;font-size:1.08rem;color:#0f172a}
"""
if old_css not in text:
    raise SystemExit('CSS esperado não encontrado; alteração cancelada.')
text = text.replace(old_css, new_css, 1)

old_media = "@media(max-width:850px){body{padding:12px}.grid,.row,.result,.tariffs{grid-template-columns:1fr}}"
new_media = "@media(max-width:850px){body{padding:12px}.grid,.row,.result,.tariffs,.comparison-grid,.details-grid{grid-template-columns:1fr}.savings-banner{align-items:flex-start;flex-direction:column}.savings-percent{text-align:left}}"
if old_media not in text:
    raise SystemExit('Media query esperada não encontrada; alteração cancelada.')
text = text.replace(old_media, new_media, 1)

pattern = re.compile(r"      resultado\.innerHTML = `\n.*?\n      `;\n      acoesResultado\.style\.display = 'flex';", re.S)
replacement = """      resultado.innerHTML = `
        <div class=\"comparison-title\">Comparação para percorrer <strong>${formatNumber(autonomiaAdicionada, 0)} km</strong></div>

        <div class=\"comparison-grid\">
          <div class=\"compare-card electric\">
            <div class=\"compare-label\">⚡ Elétrico</div>
            <div class=\"compare-value\">${formatCurrency(custoCarga)}</div>
            <div class=\"compare-sub\">custo total desta carga</div>
          </div>
          <div class=\"compare-card fuel\">
            <div class=\"compare-label\">⛽ Combustão</div>
            <div class=\"compare-value\">${formatCurrency(custoCombustaoTotal)}</div>
            <div class=\"compare-sub\">combustível para os mesmos ${formatNumber(autonomiaAdicionada, 0)} km</div>
          </div>
        </div>

        <div class=\"savings-banner\">
          <div class=\"savings-main\">💰 Poupa <strong>${formatCurrency(poupancaTotal)}</strong> nesta distância</div>
          <div class=\"savings-percent\">${formatNumber(percentagemPoupanca, 1)}% mais barato em elétrico</div>
        </div>

        <div class=\"details-title\">Detalhes do cálculo</div>
        <div class=\"details-grid\">
          <div class=\"detail-box\"><div class=\"detail-label\">Energia carregada</div><div class=\"detail-value\">${formatNumber(energiaCarregada)} kWh</div></div>
          <div class=\"detail-box\"><div class=\"detail-label\">Tempo estimado</div><div class=\"detail-value\">${formatHours(tempoCarga)}</div></div>
          <div class=\"detail-box\"><div class=\"detail-label\">Elétrico / 100 km</div><div class=\"detail-value\">${formatCurrency(custoEletrico100)}</div></div>
          <div class=\"detail-box\"><div class=\"detail-label\">Combustão / 100 km</div><div class=\"detail-value\">${formatCurrency(custoCombustao100)}</div></div>
        </div>
        <p class=\"muted\">Custo por km: elétrico ${formatCurrency(custoEletricoKm)} · combustão ${formatCurrency(custoCombustaoKm)}. Valores estimados; confirme sempre consumos reais, perdas de carregamento e preço final do posto/tarifário.</p>
      `;
      acoesResultado.style.display = 'flex';"""

text, count = pattern.subn(lambda m: replacement, text, count=1)
if count != 1:
    raise SystemExit('Bloco de resultados esperado não encontrado; alteração cancelada.')

path.write_text(text, encoding='utf-8')
