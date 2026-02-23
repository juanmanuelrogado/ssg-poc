const LOCALIZED_LABELS = {
    'en_US': {
        'title': 'Statify',
        'subtitle': 'Select pages to statify:',
        'selectAll': 'Select All',
        'statifyButton': 'Statify Selected Pages',
        'starting': 'Starting statification...',
        'selectAtLeastOne': 'Please select at least one page.',
        'success': 'Success: ',
        'error': 'Error: ',
        'webhookError': 'Is the ssg-webhook service running?',
        'noPages': 'No pages found in this site.',
        'couldNotRetrieve': 'Could not retrieve pages.',
        'errorFetching': 'Error fetching pages. Check the browser console for details.'
    },
    'es_ES': {
        'title': 'Estatificar',
        'subtitle': 'Seleccione las páginas para estatificar:',
        'selectAll': 'Seleccionar todo',
        'statifyButton': 'Estatificar páginas seleccionadas',
        'starting': 'Iniciando estatificación...',
        'selectAtLeastOne': 'Por favor, seleccione al menos una página.',
        'success': 'Éxito: ',
        'error': 'Error: ',
        'webhookError': '¿Está el servicio ssg-webhook en funcionamiento?',
        'noPages': 'No se han encontrado páginas en este sitio.',
        'couldNotRetrieve': 'No se han podido recuperar las páginas.',
        'errorFetching': 'Error al recuperar las páginas. Consulte la consola del navegador para más detalles.'
    }
};

class StatifyElement extends HTMLElement {
    constructor() {
        super();
        this.languageId = (window.Liferay && Liferay.ThemeDisplay && Liferay.ThemeDisplay.getLanguageId()) || 'en_US';
        this.labels = LOCALIZED_LABELS[this.languageId] || LOCALIZED_LABELS['en_US'];
    }

    t(key) {
        return this.labels[key] || key;
    }

    connectedCallback() {
        this.innerHTML = `
            <div id="statify-custom-element">
                <h1>${this.t('title')}</h1>
                <p>${this.t('subtitle')}</p>
                <div>
                    <input type="checkbox" id="select-all-pages">
                    <label for="select-all-pages">${this.t('selectAll')}</label>
                </div>
                <div id="page-list-container">
                    <ul id="page-list"></ul>
                </div>
                <button id="statify-button">${this.t('statifyButton')}</button>
                <div id="statify-status"></div>
            </div>
        `;

        this.fetchAndRenderPages();
        this.addEventListeners();
    }

    addEventListeners() {
        const statifyButton = this.querySelector('#statify-button');
        statifyButton.addEventListener('click', () => this.triggerStatification());

        const selectAllCheckbox = this.querySelector('#select-all-pages');
        selectAllCheckbox.addEventListener('change', (event) => {
            const checkboxes = this.querySelectorAll('#page-list input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = event.target.checked;
            });
        });
    }

    triggerStatification() {
        const statusDiv = this.querySelector('#statify-status');
        statusDiv.innerHTML = this.t('starting');

        const selectedPages = [];
        const checkboxes = this.querySelectorAll('#page-list input[type="checkbox"]:checked');
        checkboxes.forEach(checkbox => {
            selectedPages.push({
                id: checkbox.value,
                title: checkbox.nextElementSibling.textContent,
                friendlyUrlPath: checkbox.dataset.friendlyUrlPath
            });
        });

        if (selectedPages.length === 0) {
            statusDiv.innerHTML = this.t('selectAtLeastOne');
            return;
        }

        const webhookUrl = 'http://localhost:3001/api/v1/trigger-extraction';

        fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pages: selectedPages })
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Network response was not ok.');
        })
        .then(data => {
            statusDiv.innerHTML = `${this.t('success')}${data.message}`;
        })
        .catch(error => {
            statusDiv.innerHTML = `${this.t('error')}${error.message}. ${this.t('webhookError')}`;
            console.error('Error triggering statification:', error);
        });
    }

    fetchAndRenderPages() {
        const pageList = this.querySelector('#page-list');

        if (pageList && window.Liferay && window.Liferay.ThemeDisplay) {
            const siteId = Liferay.ThemeDisplay.getSiteGroupId();

            Liferay.Util.fetch(
                `/o/headless-delivery/v1.0/sites/${siteId}/site-pages`
            )
                .then((response) => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json();
                })
                .then((data) => {
                    if (data.items) {
                        console.log('StatifyElement: Building hierarchy from paths');

                        if (data.items.length === 0) {
                            pageList.innerHTML = `<li>${this.t('noPages')}</li>`;
                        } else {
                            pageList.innerHTML = '';
                            const pagesById = {};
                            const rootPages = [];

                            // First pass: Index all pages
                            data.items.forEach(page => {
                                pagesById[page.id] = { ...page, children: [] };
                            });

                            // Sort by URL path length to process parents before children
                            const sortedItems = [...data.items].sort((a, b) => a.friendlyUrlPath.length - b.friendlyUrlPath.length);

                            // Build the tree structure by inferring parents from paths
                            sortedItems.forEach(page => {
                                const pathParts = page.friendlyUrlPath.split('/').filter(p => p);
                                let parentId = 0;

                                // If path has segments (e.g., /parent/child), try to find parent (/parent)
                                if (pathParts.length > 1) {
                                    const parentPath = '/' + pathParts.slice(0, -1).join('/');
                                    const parent = data.items.find(item => item.friendlyUrlPath === parentPath);
                                    if (parent) {
                                        parentId = parent.id;
                                    }
                                }

                                if (parentId !== 0 && pagesById[parentId]) {
                                    pagesById[parentId].children.push(pagesById[page.id]);
                                } else {
                                    rootPages.push(pagesById[page.id]);
                                }
                            });

                            // Recursive function to render the tree
                            const renderTree = (pages, container, level = 0) => {
                                pages.forEach(page => {
                                    const listItem = document.createElement('li');
                                    listItem.style.listStyleType = 'none';
                                    listItem.style.padding = '0';
                                    listItem.style.margin = '0';

                                    const contentWrapper = document.createElement('div');
                                    contentWrapper.style.display = 'flex';
                                    contentWrapper.style.alignItems = 'center';
                                    contentWrapper.style.padding = '6px 0';
                                    contentWrapper.style.paddingLeft = `${level * 25}px`;
                                    contentWrapper.style.borderBottom = '1px solid #f0f0f0';

                                    // Add a visual connector for children
                                    if (level > 0) {
                                        const connector = document.createElement('span');
                                        connector.textContent = '└─';
                                        connector.style.color = '#ccc';
                                        connector.style.marginRight = '8px';
                                        connector.style.fontFamily = 'monospace';
                                        contentWrapper.appendChild(connector);
                                    }

                                    const checkbox = document.createElement('input');
                                    checkbox.type = 'checkbox';
                                    checkbox.id = `page-${page.id}`;
                                    checkbox.value = page.id;
                                    checkbox.name = 'pages';
                                    checkbox.dataset.friendlyUrlPath = page.friendlyUrlPath;

                                    const label = document.createElement('label');
                                    label.htmlFor = `page-${page.id}`;
                                    label.style.marginLeft = '10px';
                                    label.style.cursor = 'pointer';
                                    label.style.flex = '1';
                                    
                                    const titleSpan = document.createElement('span');
                                    titleSpan.textContent = page.title;
                                    titleSpan.style.fontWeight = level === 0 ? '600' : '400';
                                    titleSpan.style.fontSize = level === 0 ? '14px' : '13px';
                                    
                                    const pathSmall = document.createElement('div');
                                    pathSmall.textContent = page.friendlyUrlPath;
                                    pathSmall.style.fontSize = '10px';
                                    pathSmall.style.color = '#999';

                                    label.appendChild(titleSpan);
                                    label.appendChild(pathSmall);

                                    contentWrapper.appendChild(checkbox);
                                    contentWrapper.appendChild(label);
                                    listItem.appendChild(contentWrapper);
                                    container.appendChild(listItem);

                                    if (page.children && page.children.length > 0) {
                                        renderTree(page.children, container, level + 1);
                                    }
                                });
                            };

                            renderTree(rootPages, pageList);
                        }
                    } else {
                         pageList.innerHTML = `<li>${this.t('couldNotRetrieve')}</li>`;
                    }
                })
                .catch(error => {
                    console.error('Error fetching pages:', error);
                    pageList.innerHTML = `<li>${this.t('errorFetching')}</li>`;
                });
        } else {
            setTimeout(() => this.fetchAndRenderPages(), 100);
        }
    }
}

customElements.define('statify-element', StatifyElement);
