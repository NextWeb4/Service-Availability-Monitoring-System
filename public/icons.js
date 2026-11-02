(function () {
  const allowed = new Set(['search', 'plus', 'upload', 'download', 'refresh-cw', 'x', 'chevron-left', 'chevron-right', 'chevron-down', 'list', 'layout-grid', 'play', 'pause', 'timer', 'trash', 'arrow-left', 'external-link']);
  window.UptimeIcons = {
    render(root = document) {
      root.querySelectorAll('[data-icon]').forEach((element) => {
        const name = element.dataset.icon;
        if (!allowed.has(name) || element.firstChild) return;
        const icon = document.createElement('img');
        icon.src = `/icons/${name}.svg`;
        icon.alt = '';
        icon.width = 16;
        icon.height = 16;
        icon.setAttribute('aria-hidden', 'true');
        element.setAttribute('aria-hidden', 'true');
        element.append(icon);
      });
    }
  };
  window.UptimeIcons.render();
}());
