/* Agencia Tributaria Card Collection Fragment JavaScript */
(function() {
    'use strict';

    function renderIcons(fragmentElement) {
        if (!window.Liferay || !Liferay.Icons) {
            setTimeout(() => renderIcons(fragmentElement), 100);
            return;
        }

        const cards = fragmentElement.querySelectorAll('[data-card-index]');

        cards.forEach(card => {
            const cardIndex = card.dataset.cardIndex;
            const iconConfig = card.querySelector(`.config-icon[data-lfr-editable-id="card${cardIndex}Icon"]`);
            const defaultIcon = configuration['card' + cardIndex + 'DefaultIcon'];
            const iconName = iconConfig?.textContent.trim() || defaultIcon;

            if (iconName) {
                const svgClass = `lexicon-icon lexicon-icon-${iconName} svg-inline--fa fa-w-16 ico-size-5 card-hover-svg`;
                const xlinkHref = `${Liferay.Icons.spritemap}#${iconName}`;

                const svgElement = document.createElementNS('http://www.w3.org/2000/svg','svg');
                svgElement.setAttribute('role', 'presentation');
                svgElement.setAttribute('viewBox', '0 0 512 512');
                svgElement.setAttribute('class', svgClass);

                const useElement = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                useElement.setAttributeNS('http://www.w3.org/1999/xlink','href', xlinkHref);
                
                svgElement.appendChild(useElement);
                
                const svgSpan = card.querySelector('.card-icon');
                // Clear any existing icon before appending a new one
                svgSpan.innerHTML = ''; 
                svgSpan.appendChild(svgElement);
            }
        });
    }

    function initializeFragment(fragmentElement) {
        renderIcons(fragmentElement);
    }
    
    function init() {
        const fragmentElements = document.querySelectorAll('.at-card-collection-fragment');
        fragmentElements.forEach(el => initializeFragment(el));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    if (typeof Liferay !== 'undefined' && Liferay.on) {
        Liferay.on('endNavigate', init);
    }

})();
