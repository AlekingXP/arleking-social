(function () {
  var SELECTOR = '.btn-pill, .btn-outline, .icon-btn';

  function bind(btn) {
    if (btn.dataset.fxBound) return;
    btn.dataset.fxBound = '1';

    btn.addEventListener('click', function () {
      btn.classList.remove('btn-pop');
      void btn.offsetWidth;
      btn.classList.add('btn-pop');
    });

    btn.addEventListener('animationend', function (e) {
      if (e.animationName === 'btn-pop-3d') btn.classList.remove('btn-pop');
    });
  }

  function scan(root) {
    (root.matches && root.matches(SELECTOR) ? [root] : []).forEach(bind);
    if (root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(bind);
  }

  scan(document.body);

  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) scan(node);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
