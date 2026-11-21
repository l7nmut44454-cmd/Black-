(function(){
  const form = document.getElementById('form');
  const err = document.getElementById('error');
  const btn = document.getElementById('submit');
  const card = document.getElementById('formCard');
  const done = document.getElementById('done');

  function showError(t){ err.textContent = t; err.classList.remove('hidden'); err.scrollIntoView({block:'nearest'}); }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const data = {
      full_name: form.full_name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim()
    };
    if (data.full_name.length < 3) return showError('اكتب الاسم بالكامل.');
    if (!/^\+?[0-9\s\-]{7,20}$/.test(data.phone)) return showError('رقم الهاتف غير صحيح.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return showError('البريد الإلكتروني غير صحيح.');

    btn.disabled = true; btn.textContent = 'جارٍ الإرسال...';
    try {
      const r = await fetch('/api/register', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'حدث خطأ. حاول مرة أخرى.');
      form.reset(); card.classList.add('hidden'); done.classList.remove('hidden');
    } catch (ex) {
      showError(ex.message);
    } finally {
      btn.disabled = false; btn.textContent = 'إرسال';
    }
  });

  document.getElementById('again').addEventListener('click', () => {
    done.classList.add('hidden'); card.classList.remove('hidden'); form.full_name.focus();
  });
})();
