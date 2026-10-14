// Nav dropdowns open on hover/focus via CSS; this adds click/tap and Escape.
document.querySelectorAll('[data-dropdown]').forEach((dd) => {
  const btn = dd.querySelector('[data-dropdown-toggle]');
  const setOpen = (open) => {
    dd.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!dd.classList.contains('open'));
  });
  document.addEventListener('click', (e) => { if (!dd.contains(e.target)) setOpen(false); });
  dd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setOpen(false); btn.focus(); }
  });
});
