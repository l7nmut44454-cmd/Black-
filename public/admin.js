(function(){
  const $ = (id) => document.getElementById(id);
  const loginView = $('loginView'), dashView = $('dashView');
  let offset = 0, query = '', timer = null, reqId = 0;

  function show(el, on){ el.classList.toggle('hidden', !on); }
  function showErr(el, t){ el.textContent = t; show(el, !!t); }

  async function api(url, opts){
    const r = await fetch(url, Object.assign({credentials:'same-origin'}, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/api/admin/login') { showLogin(); throw new Error(j.error || 'انتهت الجلسة'); }
    if (!r.ok) throw new Error(j.error || 'حدث خطأ');
    return j;
  }

  function showLogin(){ show(dashView, false); show(loginView, true); $('password').value = ''; }
  function showDash(){ show(loginView, false); show(dashView, true); load(true); }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); showErr($('loginError'), '');
    const b = $('loginBtn'); b.disabled = true;
    try {
      await api('/api/admin/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username:$('username').value, password:$('password').value})
      });
      showDash();
    } catch (ex) { showErr($('loginError'), ex.message); }
    finally { b.disabled = false; }
  });

  $('logout').addEventListener('click', async () => {
    try { await api('/api/admin/logout', {method:'POST'}); } catch {}
    showLogin();
  });

  $('search').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = $('search').value.trim(); load(true); }, 300);
  });
  $('more').addEventListener('click', () => load(false));

  function fmtDate(s){
    try { return new Date(s).toLocaleString('ar-EG', {dateStyle:'medium', timeStyle:'short'}); }
    catch { return s; }
  }

  function cell(tr, label, text, cls){
    const td = document.createElement('td');
    td.dataset.label = label; td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td); return td;
  }

  function buildTable(){
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>التاريخ</th><th></th></tr></thead><tbody></tbody>';
    return t;
  }

  async function load(reset){
    const my = ++reqId;
    if (reset) offset = 0;
    showErr($('dashError'), '');
    try {
      const j = await api('/api/admin/people?q=' + encodeURIComponent(query) + '&offset=' + offset);
      if (my !== reqId) return;
      const wrap = $('listWrap');
      if (reset) wrap.textContent = '';
      $('count').textContent = 'العدد: ' + j.total;

      if (j.total === 0) {
        wrap.innerHTML = '';
        const d = document.createElement('div'); d.className = 'empty';
        d.textContent = query ? 'لا توجد نتائج مطابقة للبحث.' : 'لا يوجد مسجّلون حتى الآن.';
        wrap.appendChild(d);
        show($('more'), false); return;
      }

      let table = wrap.querySelector('table');
      if (!table) { table = buildTable(); wrap.appendChild(table); }
      const tbody = table.querySelector('tbody');

      j.rows.forEach((p) => {
        const tr = document.createElement('tr');
        cell(tr, 'الاسم', p.full_name);
        cell(tr, 'الهاتف', p.phone, 'ltr');
        cell(tr, 'البريد', p.email, 'ltr');
        cell(tr, 'التاريخ', fmtDate(p.created_at));
        const td = document.createElement('td'); td.className = 'actions';
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn-danger'; del.textContent = 'حذف';
        del.addEventListener('click', () => remove(p, tr));
        td.appendChild(del); tr.appendChild(td);
        tbody.appendChild(tr);
      });
      offset += j.rows.length;
      show($('more'), j.hasMore);
    } catch (ex) { if (my === reqId) showErr($('dashError'), ex.message); }
  }

  async function remove(p, tr){
    if (!confirm('هل تريد حذف بيانات "' + p.full_name + '" نهائيًا؟')) return;
    try {
      await api('/api/admin/people/' + p.id, {method:'DELETE'});
      tr.remove(); offset = Math.max(0, offset - 1);
      load(true);
    } catch (ex) { showErr($('dashError'), ex.message); }
  }

  api('/api/admin/me').then(showDash).catch(showLogin);
})();
