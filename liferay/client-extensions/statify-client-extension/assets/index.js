class StatifyElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this.innerHTML = `
            <div id="statify-custom-element">
                <h1>Statify</h1>
                <p>Select pages to statify:</p>
                <div id="page-list-container">
                    <ul id="page-list"></ul>
                </div>
                <button id="statify-button">Statify Selected Pages</button>
            </div>
        `;

        this.fetchAndRenderPages();
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
                        if (data.items.length === 0) {
                            pageList.innerHTML = '<li>No pages found in this site.</li>';
                        } else {
                            data.items.forEach((page) => {
                                const listItem = document.createElement('li');
                                const checkbox = document.createElement('input');
                                checkbox.type = 'checkbox';
                                checkbox.id = `page-${page.id}`;
                                checkbox.value = page.id;
                                checkbox.name = 'pages';

                                const label = document.createElement('label');
                                label.htmlFor = `page-${page.id}`;
                                label.textContent = page.title;

                                listItem.appendChild(checkbox);
                                listItem.appendChild(label);
                                pageList.appendChild(listItem);
                            });
                        }
                    } else {
                         pageList.innerHTML = '<li>Could not retrieve pages.</li>';
                    }
                })
                .catch(error => {
                    console.error('Error fetching pages:', error);
                    pageList.innerHTML = '<li>Error fetching pages. Check the browser console for details.</li>';
                });
        } else {
            // If Liferay object is not ready, wait and try again.
            setTimeout(() => this.fetchAndRenderPages(), 100);
        }
    }
}

customElements.define('statify-element', StatifyElement);