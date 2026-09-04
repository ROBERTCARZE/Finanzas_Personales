// ============================================
// Riel de navegación — estado contraído/expandido
// Se incluye como script normal (no módulo) en el
// <head> de cada página para evitar el parpadeo:
// aplica la clase ANTES de que se pinte el riel.
// ============================================

(function () {
  var collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
  if (collapsed) document.documentElement.classList.add('sidebar-collapsed');
})();

document.addEventListener('DOMContentLoaded', function () {
  var toggleBtn = document.getElementById('sidebarToggle');
  if (!toggleBtn) return;
  toggleBtn.addEventListener('click', function () {
    var isCollapsed = document.documentElement.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
  });
});
