/* Black Vial Society — app.js (vanilla) */

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------- RAW PRICE MAP ---------- */
const RAW_PRICE_MAP = Object.create(null);

function rebuildRawPriceMap(){
  for(const key of Object.keys(RAW_PRICE_MAP)) delete RAW_PRICE_MAP[key];
  for(const row of (PRICES_RAW || [])){
    const [name, dose, price] = row;
    if(!RAW_PRICE_MAP[name]) RAW_PRICE_MAP[name] = Object.create(null);
    RAW_PRICE_MAP[name][dose] = Number(price) || 0;
  }
}

const ITEM_CATEGORY_MAP = Object.create(null);

function rebuildItemCategoryMap(){
  for (const key of Object.keys(ITEM_CATEGORY_MAP)) delete ITEM_CATEGORY_MAP[key];

  for (const item of (GUIDE || [])) {
    ITEM_CATEGORY_MAP[item.name] = item.category || '';
  }
}

/* ---------- Utilities ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money = n => `$${Number(n).toFixed(2)}`;
const num = n => Number(n).toFixed(2);

function parseAmount(str){
  // "10 mg" or "5000 IU" -> {amount:10, unit:"mg"}
  const m = String(str).trim().match(/([\d.]+)\s*([a-zA-Zµμ]+)/);
  if(!m) return {amount: NaN, unit: ""};
  let unit = m[2].toLowerCase();
  unit = unit.replace('μ','u').replace('µ','u'); // normalize
  if(unit === 'mcg') unit = 'mcg';
  if(unit === 'iu') unit = 'iu';
  if(unit === 'mg') unit = 'mg';
  return {amount: Number(m[1]), unit};
}

function stockClass(n){
  const v = Number(n)||0;
  if(v<=0) return 'out';
  if(v<=5) return 'low';
  return 'ok';
}

const SPECIAL_MULTIPLIER_ITEMS = new Set([
  "GLP-3RT (Retatrutide)",
  "GLP-2TZ (Tirzepatide)",
  "HGH 191AA (Somatropin)"
]);

function getPrice(itemName, doseLabel){
  const lookupName = itemName || '';
  const base = RAW_PRICE_MAP[lookupName]?.[doseLabel];

  if(base == null){
    console.warn('Missing raw price:', lookupName, doseLabel);
    return NaN;
  }

  const category = ITEM_CATEGORY_MAP[lookupName] || '';
  const isSupply = category === 'supplies';
  const isKit = /kit/i.test(String(doseLabel));

  let multiplier = 1;

  if (isSupply) {
    multiplier = 1;
  } else if (isKit) {
    multiplier = KIT_MULTIPLIER;
  } else if (SPECIAL_MULTIPLIER_ITEMS.has(lookupName)) {
    multiplier = PRICE_MULTIPLIER; // 4.29
  } else {
    multiplier = DEFAULT_MULTIPLIER; // your separate peptide multiplier
  }

  return Math.round(Number(base) * multiplier);
}

/* ---------- Classic math with unit handling ---------- */
function classicCalc({amountPerVial, vialUnit='mg', diluentMl, desired, desiredUnit='mg', syringeScale=100}) {
  const amt   = Number(amountPerVial)||0;
  const mlD   = Number(diluentMl)||0;
  const want  = Number(desired)||0;
  const scale = Number(syringeScale)||100;

  const vUnit = String(vialUnit||'mg').toLowerCase();
  const dUnit = String(desiredUnit||'mg').toLowerCase();

  let desiredInVial = NaN;
  let note = '';

  if (vUnit === 'mg') {
    if (dUnit === 'mg') desiredInVial = want;
    else if (dUnit === 'mcg') desiredInVial = want/1000;
    else if (dUnit === 'iu') note = 'Unit mismatch: this vial is in mg, but desired dose is in IU. mg ↔ IU conversion is not possible without a product-specific factor.';
    else note = 'Unsupported desired dose unit.';
  } else if (vUnit === 'iu') {
    if (dUnit === 'iu') desiredInVial = want;
    else if (dUnit === 'mg' || dUnit === 'mcg') note = 'Unit mismatch: this vial is in IU, but desired dose is in mg/mcg. mg ↔ IU conversion is not possible without a product-specific factor.';
    else note = 'Unsupported desired dose unit.';
  } else {
    note = 'Unsupported vial unit.';
  }

  // concentration in "vial units" (mg or IU) per mL
  const perMl = (amt>0 && mlD>0) ? (amt/mlD) : NaN;

  // insulin syringe assumption: 1 unit = 0.01 mL
  const vialUnitsPerUnit = isFinite(perMl) ? (perMl * 0.01) : NaN;

  // syringe units to pull
  const syringeUnits = (isFinite(vialUnitsPerUnit) && isFinite(desiredInVial) && desiredInVial>=0)
    ? (desiredInVial / vialUnitsPerUnit)
    : NaN;

  const pct = (isFinite(syringeUnits) && scale>0)
    ? Math.max(0, Math.min(100, (syringeUnits/scale)*100))
    : 0;

  return { vialUnit:vUnit, desiredUnit:dUnit, vialUnitsPerUnit, units:syringeUnits, unitsPct:pct, syringeScale:scale, note };
}

/* ---------- Persistence ---------- */
const store = {
  get(key, fallback){
    try{
      const v = localStorage.getItem(key);
      return v==null ? fallback : JSON.parse(v);
    }catch{ return fallback; }
  },
  set(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
  }
};

/* ---------- State ---------- */
let DATA = null;
let GUIDE = [];
let PRICES_RAW = [];

let activeTab = store.get('bvs.tab', 'guide');
let guideFilter = store.get('bvs.guideFilter', 'all');
let hideOosGuide = store.get('bvs.hideOosGuide', false);
let hideOosPrices = store.get('bvs.hideOosPrices', false);
let guideExpanded = store.get('bvs.guideExpanded', false);

let sortKey = store.get('bvs.priceSortKey', 'name');
let sortDir = store.get('bvs.priceSortDir', 'asc');

// Price inflation for everything else
const DEFAULT_MULTIPLIER = 2.5; // 
//Reta, Tirz, and HGH specific.
const PRICE_MULTIPLIER = 4.29;
// Kit-specific multiplier
const KIT_MULTIPLIER = 2;

const NO_INCREASE = new Set([
  "bacteriostatic water",
  "hospira bacteriostatic water",
  "acetic acid",
  "bac water",
  "hospira bac water",
  "lemon bottle",
  "easytouch 31 gauge 1ml 5/16\" 8mm"
]);

/**
 * Dollar rounding with a cutoff:
 * - exact .00 stays
 * - cents <= 0.30 => down to current dollar
 * - cents >  0.30 => up to next dollar
 *
 * Examples:
 * 42.00 => 42
 * 42.30 => 42
 * 42.31 => 43
 * 41.50 => 42
 */
function roundDollarCutoff(n){
  const v = Number(n);
  if(!isFinite(v)) return NaN;

  // Snap to 2 decimals to avoid float artifacts
  const cents = Math.round(v * 100) / 100;

  const whole = Math.floor(cents);
  const frac = cents - whole; // 0.00 .. 0.99

  if(frac === 0) return whole;
  if(frac <= 0.30) return whole;
  return whole + 1;
}

/* ---------- Tabs (ARIA + keyboard) ---------- */
function setTab(tab){
  activeTab = 'guide';
  store.set('bvs.tab', 'guide');

  const guideBtn = $('#tab-guide');
  const guidePanel = $('#panel-guide');
  if(guideBtn){
    guideBtn.classList.add('active');
    guideBtn.setAttribute('aria-selected', 'true');
  }
  if(guidePanel){
    guidePanel.classList.add('active');
    guidePanel.focus({preventScroll:true});
  }
}

function wireTabs(){
  const guideBtn = $('#tab-guide');
  if(!guideBtn) return;
  guideBtn.addEventListener('click', ()=> setTab('guide'));
  guideBtn.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      setTab('guide');
    }
  });
}

/* ---------- Guide rendering ---------- */
function guidePasses(item, q){
  const query = q.trim().toLowerCase();
  const inText = (item.name + ' ' + item.short + ' ' + (item.badge||'') + ' ' + (item.category||'')).toLowerCase();
  const passQ = !query || inText.includes(query);
  let passFilter = true;


  if(guideFilter === 'kits'){
    const hasKit = (item.doses || []).some(d => /kit\s*x\s*10/i.test(String(d)));
    passFilter = hasKit;
  }else if(guideFilter !== 'all'){
    passFilter = item.category === guideFilter;
  }

  let inStock = false;
  if(item.stock && typeof item.stock === 'object'){
    inStock = Object.values(item.stock).some(v => Number(v)>0);
  }
  const passOOS = !hideOosGuide || inStock;

  return passQ && passFilter && passOOS;
}

function renderGuide(){
  const q = $('#q').value || '';
  const grid = $('#grid');
  grid.innerHTML = '';

  const filtered = (GUIDE||[]).filter(item => guidePasses(item, q));
  $('#empty').style.display = filtered.length ? 'none' : 'block';
  $('#gstatus').textContent = filtered.length ? `Showing ${filtered.length} item${filtered.length===1?'':'s'}.` : '';

  if(!filtered.length) return;

  const KIT_RE = /kit\s*x\s*10/i;

  function splitItem(item){
    const doses = Array.isArray(item.doses) ? item.doses : [];
    const singleDoses = doses.filter(label => !KIT_RE.test(String(label)));
    const kitDoses = doses.filter(label => KIT_RE.test(String(label)));

    const makeStock = (labels) => {
      const out = {};
      for(const label of labels){
        out[label] = item.stock && item.stock[label] != null ? item.stock[label] : 0;
      }
      return out;
    };

    const singleItem = singleDoses.length ? {
      ...item,
      key: item.key,
      priceLookupName: item.name,
      doses: singleDoses,
      stock: makeStock(singleDoses),
      isKitCard: false
    } : null;

    const kitItem = kitDoses.length ? {
      ...item,
      key: item.key,
      priceLookupName: item.name,
      name: `${item.name} — Kit`,
      badge: 'KIT',
      doses: kitDoses,
      stock: makeStock(kitDoses),
      fact: 'Form: 10 vial kit',
      isKitCard: true
    } : null;

    return { singleItem, kitItem };
  }

  const singles = [];
  const kits = [];

  for(const item of filtered){
    const { singleItem, kitItem } = splitItem(item);
    if(singleItem) singles.push(singleItem);
    if(kitItem) kits.push(kitItem);
  }

  if(guideFilter === 'kits'){
    grid.innerHTML = `
      <div class="guide-section kits-section">
        <h2 class="section-title kits">Kits</h2>
        <div class="section-grid" id="kitGrid"></div>
      </div>
    `;
  } else {
    grid.innerHTML = `
      <div class="guide-section">
        <h2 class="section-title">Single Vials</h2>
        <div class="section-grid" id="singleGrid"></div>
      </div>

      <div class="guide-section kits-section">
        <h2 class="section-title kits">Kits</h2>
        <div class="section-grid" id="kitGrid"></div>
      </div>
    `;
  }

  const singleGrid = document.getElementById('singleGrid');
  const kitGrid = document.getElementById('kitGrid');

  function renderCard(item, targetGrid){
    const detailsOpen = guideExpanded;
    const prices = (item.doses || [])
      .map(label => getPrice(item.priceLookupName || item.name, label))
      .filter(v => Number.isFinite(v));
    const minPrice = prices.length ? Math.min(...prices) : NaN;
    const maxPrice = prices.length ? Math.max(...prices) : NaN;
    const rangeText = prices.length
      ? (minPrice === maxPrice ? `${money(minPrice)}` : `${money(minPrice)}–${money(maxPrice)} range`)
      : 'Pricing unavailable';

    const doses = (item.doses||[]).map(label=>{
      const stock = (item.stock && item.stock[label] != null) ? Number(item.stock[label]) : null;
      const out = stock!=null && stock<=0;
      const cls = stockClass(stock);
      let badge = '';

      if(stock!=null){
        let labelTxt = '';
        if(out) labelTxt = 'Out of stock';
        else if(stock<=5) labelTxt = `${stock} low stock`;
        else labelTxt = `${stock} in stock`;
        badge = `<span class="stock-badge ${cls}">${labelTxt}</span>`;
      }

      return `
        <button class="dose" type="button" data-key="${esc(item.key)}" data-dose="${esc(label)}" ${out?'disabled':''}>
          <span>${esc(label)}</span>
          ${badge}
        </button>
      `;
    }).join('');

    const more = item.more ? item.more : '<ul><li>Educational info only.</li></ul>';

    const html = `
      <article class="card ${item.isKitCard ? 'kit-card' : ''}" data-key="${esc(item.key)}" data-modal-name="${esc(item.name)}" data-modal-badge="${esc(item.badge||'')}" data-modal-more="${esc(item.more || '')}">
        <div class="title">
          <h3>${esc(item.name)}</h3>
          <span class="pill ${item.isKitCard ? 'pill-kit' : ''}">${esc(item.badge||'')}</span>
        </div>

        <div class="price-range">${esc(rangeText)}</div>
        <div style="display:flex; gap:8px; margin-top:2px;">
          <button class="view-btn" type="button" data-view-key="${esc(item.key)}">View</button>
        </div>

        <div class="desc">${esc(item.short||'')}</div>
        <div class="onset">${esc(item.onset||'')}</div>

        <div class="dose-block">
          <div class="dose-label" style="margin-top:10px">${esc(item.fact||'')}</div>
          <div class="doses" style="margin-top:8px">${doses}</div>
        </div>

        <details class="moreinfo" ${detailsOpen?'open':''}>
          <summary>More info</summary>
          <div class="desc" style="margin-top:10px">${more}</div>
        </details>
      </article>
    `;

    targetGrid.insertAdjacentHTML('beforeend', html);
  }

  if(singleGrid){
    if(singles.length){
      for(const item of singles){
        renderCard(item, singleGrid);
      }
    } else {
      singleGrid.innerHTML = '<div class="empty">No single vials available.</div>';
    }
  }
  
  if(kitGrid){
    if(kits.length){
      for(const item of kits){
        renderCard(item, kitGrid);
      }
    } else {
      kitGrid.innerHTML = '<div class="empty">No kits available.</div>';
    }
  }
  try{
    wireCardTilt();
  }catch(e){
    console.log('Tilt error:', e);
  }
}


function setGuideFilter(filter){
  guideFilter = filter;
  store.set('bvs.guideFilter', filter);
  $$('.toolbar [data-filter]').forEach(btn=>{
    const is = btn.dataset.filter === filter;
    btn.classList.toggle('active', is);
    btn.setAttribute('aria-pressed', String(is));
  });
  renderGuide();
}

function setHideOosGuide(v){
  hideOosGuide = !!v;
  store.set('bvs.hideOosGuide', hideOosGuide);
  const btn = $('#toggleOOS');
  btn.setAttribute('aria-pressed', String(hideOosGuide));
  btn.textContent = hideOosGuide ? 'Show out-of-stock' : 'Hide out-of-stock';
  renderGuide();
}

function setGuideExpanded(v){
  guideExpanded = !!v;
  store.set('bvs.guideExpanded', guideExpanded);
  $$('details.moreinfo').forEach(d => d.open = guideExpanded);
}

/* ---------- Prices ---------- */
function computePrices(){
  // PRICES_RAW: [name, strength, basePrice, unit, stock]
  return (PRICES_RAW||[]).map(row=>{
    const [name, strength, basePrice, unit, stock] = row;

    const {amount, unit: parsedUnit} = parseAmount(strength);
    const unitNorm = (String(unit||parsedUnit||'').trim() || '').toString();
    const s = Number(stock)||0;

    const base = Number(basePrice)||0;

    // Match original behavior:
    // - Do NOT inflate certain item names
    // - Do NOT inflate units "mL" or "pack"
    const category = ITEM_CATEGORY_MAP[name] || '';
    const isSupply = category === 'supplies';
    const isKit = /kit\s*x\s*10/i.test(String(strength)) || /\bkit\b/i.test(String(name));
    
    let multiplier = 1;
    
    if (isSupply) {
      multiplier = 1;
    } else if (isKit) {
      multiplier = KIT_MULTIPLIER;
    } else if (SPECIAL_MULTIPLIER_ITEMS.has(name)) {
      multiplier = PRICE_MULTIPLIER; // 4.29
    } else {
      multiplier = DEFAULT_MULTIPLIER;
    }
    
    const inflated = base * multiplier;
    // NEW behavior: cutoff rounding (<= $0.30 down; otherwise up)
    const finalPrice = roundDollarCutoff(inflated);

    const amt = isFinite(amount) ? amount : NaN;
    
    return {
      name,
      strength,
      amount: amt,
      price: finalPrice,
      priceBase: base,
      stock: s,
      unit: unitNorm,
      skipInflation: isSupply,
      isKit,
      multiplierUsed: multiplier
  };
  });
}

function pricePasses(item, q){
  const query = q.trim().toLowerCase();
  const inText = (item.name + ' ' + item.strength + ' ' + item.unit).toLowerCase();
  const passQ = !query || inText.includes(query);
  const passOOS = !hideOosPrices || item.stock>0;
  return passQ && passOOS;
}

function renderPrices(){
  const pq = $('#pq');
  const table = $('#priceTable');
  if(!pq || !table) return;
  const q = pq.value || '';
  const tbody = $('#priceTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';

  let rows = computePrices().filter(r => pricePasses(r, q));

  rows.sort((a,b)=>{
    const dir = sortDir === 'asc' ? 1 : -1;
    const ak = a[sortKey], bk = b[sortKey];
    if(typeof ak === 'string') return ak.localeCompare(bk) * dir;
    const av = Number(ak), bv = Number(bk);
    if(isNaN(av) && isNaN(bv)) return 0;
    if(isNaN(av)) return 1;
    if(isNaN(bv)) return -1;
    return (av-bv) * dir;
  });

  const pempty = $('#pempty');
  const pstatus = $('#pstatus');
  if(pempty) pempty.style.display = rows.length ? 'none' : 'block';
  if(pstatus) pstatus.textContent = rows.length ? `Showing ${rows.length} row${rows.length===1?'':'s'}.` : '';

  const singles = rows.filter(r => !r.isKit);
  const kits = rows.filter(r => r.isKit);

  let html = '';

  html += `
    <tr class="section-row">
      <td colspan="4">Single Vials</td>
    </tr>
  `;

  if(singles.length){
    for(const r of singles){
      const cls = stockClass(r.stock);
      html += `
        <tr>
          <td>${esc(r.name)}</td>
          <td>${esc(r.strength)}</td>
          <td class="num" title="Raw ${money(r.priceBase)} × ${r.multiplierUsed}">${money(r.price)}</td>
          <td class="num"><span class="stock-badge ${cls}">${r.stock}</span></td>
        </tr>
      `;
    }
  } else {
    html += `
      <tr>
        <td colspan="4" class="empty-note">No single vials found.</td>
      </tr>
    `;
  }

  html += `
    <tr class="section-row kits">
      <td colspan="4">Kits</td>
    </tr>
  `;

  if(kits.length){
    for(const r of kits){
      const cls = stockClass(r.stock);
      html += `
        <tr>
          <td>${esc(r.name)}</td>
          <td>${esc(r.strength)}</td>
          <td class="num" title="Raw ${money(r.priceBase)} × ${r.multiplierUsed} (kit)">${money(r.price)}</td>
          <td class="num"><span class="stock-badge ${cls}">${r.stock}</span></td>
        </tr>
      `;
    }
  } else {
    html += `
      <tr>
        <td colspan="4" class="empty-note">No kits found.</td>
      </tr>
    `;
  }

  tbody.innerHTML = html;
  updateSortUI();
}

function setHideOosPrices(v){
  hideOosPrices = !!v;
  store.set('bvs.hideOosPrices', hideOosPrices);
  const btn = $('#ptoggleOOS');
  if(btn){
    btn.setAttribute('aria-pressed', String(hideOosPrices));
    btn.textContent = hideOosPrices ? 'Show out-of-stock' : 'Hide out-of-stock';
  }
  renderPrices();
}

function setSort(key){
  if(sortKey === key){
    sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
  }else{
    sortKey = key;
    sortDir = 'asc';
  }
  store.set('bvs.priceSortKey', sortKey);
  store.set('bvs.priceSortDir', sortDir);
  renderPrices();
}

function updateSortUI(){
  if(!$('#priceTable')) return;
  // aria-sort on the active th; arrows
  $$('#priceTable thead th.sort').forEach(th=>{
    const k = th.dataset.sort;
    const arrow = th.querySelector('.arrow');
    if(k === sortKey){
      th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      if(arrow) arrow.textContent = sortDir === 'asc' ? '▲' : '▼';
    }else{
      th.removeAttribute('aria-sort');
      if(arrow) arrow.textContent = '';
    }
  });
}

/* ---------- Wiring ---------- */
async function loadData(){
  const res = await fetch('data.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load data.json');
  DATA = await res.json();
  GUIDE = DATA.guide || [];
  PRICES_RAW = DATA.prices_raw || [];
  rebuildRawPriceMap();
  rebuildItemCategoryMap();
  const updatedEl = $('#updated');
  if(updatedEl) updatedEl.textContent = DATA.updated ? `Updated: ${DATA.updated}` : '';
}

function wireGuide(){
  const q = $('#q');
  if(q) q.addEventListener('input', ()=> renderGuide());

  $$('.toolbar [data-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=> setGuideFilter(btn.dataset.filter));
  });

  const toggleOos = $('#toggleOOS');
  if(toggleOos) toggleOos.addEventListener('click', ()=> setHideOosGuide(!hideOosGuide));
  const expand = $('#expand');
  if(expand) expand.addEventListener('click', ()=> { setGuideExpanded(true); renderGuide(); });
  const collapse = $('#collapse');
  if(collapse) collapse.addEventListener('click', ()=> { setGuideExpanded(false); renderGuide(); });

  const grid = $('#grid');
  if(!grid) return;

  grid.addEventListener('click', (e)=>{
    const viewBtn = e.target.closest('[data-view-key]');
    if(viewBtn){
      openModal(viewBtn.dataset.viewKey);
      return;
    }
  });
}

function wirePrices(){
  const pq = $('#pq');
  const ptoggle = $('#ptoggleOOS');
  const priceTable = $('#priceTable');
  if(!pq || !ptoggle || !priceTable) return;

  pq.addEventListener('input', ()=> renderPrices());
  ptoggle.addEventListener('click', ()=> setHideOosPrices(!hideOosPrices));

  $$('#priceTable thead th.sort').forEach(th=>{
    th.style.cursor = 'pointer';
    th.addEventListener('click', ()=> setSort(th.dataset.sort));
  });
}

/* ---------- Modal ---------- */
function normalizeMoreHtml(more){
  if(!more) return '<ul><li>Educational info only.</li></ul>';
  const trimmed = String(more).trim();
  return trimmed;
}

function openModal(key){
  const item = GUIDE.find(x => x.key === key);
  const modal = $('#productModal');
  if(!item || !modal) return;

  const title = $('#modalTitle');
  const category = $('#modalCategory');
  const modalDoses = $('#modalDoses');
  const modalInfo = $('#modalInfo');

  if(title) title.textContent = item.name;
  if(category) category.textContent = item.badge || '';

  if(modalDoses){
    modalDoses.innerHTML = (item.doses || []).map((dose, idx)=>{
      const active = idx === 0 ? 'active' : '';
      return `<button type="button" class="dose ${active}" data-modal-dose="${esc(dose)}" data-modal-key="${esc(key)}">${esc(dose)}</button>`;
    }).join('');
  }

  if(modalInfo) modalInfo.innerHTML = normalizeMoreHtml(item.more);

  modal.classList.add('open');
  if(item.doses?.length) selectDose(key, item.doses[0]);
}

function closeModal(){
  const modal = $('#productModal');
  if(modal) modal.classList.remove('open');
}

function selectDose(key, dose){
  const item = GUIDE.find(x => x.key === key);
  if(!item) return;
  const price = getPrice(item.name, dose);
  const modalPrice = $('#modalPrice');
  const modalLine = $('#modalLine');
  if(modalPrice) modalPrice.textContent = money(price);
  if(modalLine) modalLine.textContent = `${item.name} — ${dose} — ${money(price)}`;

  $$('#modalDoses [data-modal-dose]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.modalDose === dose);
  });
}

window.openModal = openModal;
window.closeModal = closeModal;
window.selectDose = selectDose;


function ensureDynamicPricingStyles(){
  if(document.getElementById('bvs-dynamic-pricing-styles')) return;
  const style = document.createElement('style');
  style.id = 'bvs-dynamic-pricing-styles';
  style.textContent = `
    .price-range{font-size:20px;font-weight:800;color:#fff;margin-top:4px}
    .view-btn{border:1px solid #5a1b1b;background:#1a1c22;color:#fff;padding:8px 14px;border-radius:10px;cursor:pointer}
    .view-btn:hover{border-color:#c33;background:#231418}
    .bvs-modal-body{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:20px}
    .modal-left,.modal-right{display:flex;flex-direction:column;gap:14px}
    .price-big{font-size:34px;font-weight:900;line-height:1}
    .line-item{opacity:.9}
    .add-btn{margin-top:8px;border:1px solid #8f1d1d;background:linear-gradient(180deg,#3c1313,#240a0a);color:#fff;padding:12px 14px;border-radius:999px;font-weight:800}
    @media (max-width: 800px){.bvs-modal-body{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async ()=>{
  ensureDynamicPricingStyles();
  wireTabs();

  try{
    await loadData();
  }catch(err){
    console.error(err);
    const gstatus = $('#gstatus');
    const pstatus = $('#pstatus');
    if(gstatus) gstatus.textContent = 'Error loading data.';
    if(pstatus) pstatus.textContent = 'Error loading data.';
    return;
  }

  setTab('guide');
  setGuideFilter(guideFilter);
  setHideOosGuide(hideOosGuide);
  setHideOosPrices(hideOosPrices);
  setGuideExpanded(guideExpanded);

  wireGuide();
  wirePrices();

  const modal = $('#productModal');
  if(modal){
    modal.addEventListener('click', (e)=>{
      if(e.target === modal) closeModal();
      const doseBtn = e.target.closest('[data-modal-dose]');
      if(doseBtn) selectDose(doseBtn.dataset.modalKey, doseBtn.dataset.modalDose);
    });
  }

  renderGuide();
  renderPrices();
});

function wireCardTilt(){
  document.querySelectorAll('.card').forEach(card=>{
    card.addEventListener('mousemove', e=>{
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const midX = rect.width / 2;
      const midY = rect.height / 2;

      const rotateX = ((y - midY) / midY) * 6;
      const rotateY = ((x - midX) / midX) * -6;

      card.style.transform = `
        perspective(800px)
        rotateX(${rotateX}deg)
        rotateY(${rotateY}deg)
        scale(1.05)
      `;
    });

    card.addEventListener('mouseleave', ()=>{
      card.style.transform = '';
    });
  });
}
