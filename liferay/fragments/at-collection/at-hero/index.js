/* Agencia Tributaria Hero Fragment JavaScript */
(function() {
    'use strict';
    
    // Function to detect edit mode - primarily for debugging or advanced behaviors
    function isInEditMode() {
        const body = document.body;
        
        const hasEditModeMenu = body.classList.contains('has-edit-mode-menu');
        const isEditMode = body.classList.contains('is-edit-mode');
        const hasEditorEnabled = document.documentElement.getAttribute('data-editor-enabled') === 'true';
        
        const urlContainsEdit = window.location.href.includes('p_l_mode=edit') ||
                               window.location.href.includes('pageDesign');
        
        return hasEditModeMenu || isEditMode || hasEditorEnabled || urlContainsEdit;
    }

    // Initialize on DOM ready and SPA navigation events
    function initializeHero() {
        if (isInEditMode()) {
            console.log('AT Hero: In edit mode');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeHero);
    } else {
        initializeHero();
    }
    
    // Also re-initialize on SPA navigation for Liferay
    if (typeof Liferay !== 'undefined' && Liferay.on) {
        Liferay.on('endNavigate', initializeHero);
    }

})();