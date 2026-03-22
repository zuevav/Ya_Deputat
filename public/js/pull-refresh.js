// Pull-to-refresh with Russian flag — pushes content down
(function() {
  let startY = 0, currentY = 0, pulling = false, refreshing = false;
  const THRESHOLD = 100;

  // Create flag element — hidden by default
  const flag = document.createElement('div');
  flag.id = 'ptr-wrapper';
  flag.style.display = 'none';
  flag.innerHTML = `<div id="ptr-content">
    <div id="ptr-flag">
      <div class="ptr-stripe ptr-white"></div>
      <div class="ptr-stripe ptr-blue"></div>
      <div class="ptr-stripe ptr-red"></div>
    </div>
    <div id="ptr-text"></div>
  </div>`;
  document.body.appendChild(flag);

  const ptrText = document.getElementById('ptr-text');
  const ptrFlag = document.getElementById('ptr-flag');

  function getContainer() {
    return document.querySelector('.container') || document.querySelector('#deputy-content');
  }

  function isAtTop() { return window.scrollY <= 2; }

  // Only activate on main tabs, not inside event detail
  function canPull() {
    var backBtn = document.getElementById('back-btn');
    return !backBtn || backBtn.classList.contains('hidden');
  }

  // Haptic for Android
  let lastHaptic = 0;
  function haptic(ms) {
    if (navigator.vibrate && Date.now() - lastHaptic > 100) {
      navigator.vibrate(ms || 5);
      lastHaptic = Date.now();
    }
  }

  document.addEventListener('touchstart', function(e) {
    if (refreshing || !canPull()) return;
    if (isAtTop()) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!pulling || refreshing) return;
    currentY = e.touches[0].clientY;
    let distance = currentY - startY;
    if (distance < 10) return;
    if (distance < 0) { distance = 0; pulling = false; return; }

    flag.style.display = 'flex';
    const resistance = Math.min(distance / 2.5, 120);
    const progress = Math.min(distance / THRESHOLD, 1);
    const container = getContainer();

    if (container) {
      container.style.transition = 'none';
      container.style.transform = 'translateY(' + resistance + 'px)';
    }

    flag.style.height = resistance + 'px';
    flag.style.opacity = Math.min(progress * 1.5, 1);
    ptrFlag.style.transform = 'scale(' + (0.5 + progress * 0.5) + ')';

    var stripes = ptrFlag.querySelectorAll('.ptr-stripe');
    for (var i = 0; i < stripes.length; i++) {
      stripes[i].style.transform = 'skewX(' + (Math.sin(Date.now()/150 + i*1.5) * progress * 6) + 'deg)';
    }

    if (progress >= 1) {
      if (!ptrFlag.classList.contains('ptr-ready')) haptic(15);
      ptrText.textContent = 'Отпустите';
      ptrFlag.classList.add('ptr-ready');
    } else {
      ptrText.textContent = '';
      ptrFlag.classList.remove('ptr-ready');
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!pulling || refreshing) return;
    pulling = false;
    const distance = currentY - startY;
    const container = getContainer();

    if (distance >= THRESHOLD) {
      refreshing = true;
      if (container) {
        container.style.transition = 'transform 0.3s ease';
        container.style.transform = 'translateY(60px)';
      }
      flag.style.transition = 'height 0.3s ease';
      flag.style.height = '60px';
      ptrText.textContent = 'Обновление...';
      ptrFlag.classList.add('ptr-spinning');
      setTimeout(function() { location.reload(); }, 800);
    } else {
      if (container) {
        container.style.transition = 'transform 0.25s ease';
        container.style.transform = '';
        setTimeout(function() { if (container) { container.style.transition = ''; container.style.transform = ''; } }, 250);
      }
      flag.style.transition = 'height 0.25s ease, opacity 0.25s ease';
      flag.style.height = '0';
      flag.style.opacity = '0';
      setTimeout(function() { flag.style.transition = ''; flag.style.display = 'none'; }, 250);
    }
    currentY = 0; startY = 0;
  }, { passive: true });
})();
