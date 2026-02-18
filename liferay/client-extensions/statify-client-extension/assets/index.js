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
                <div id="statify-status"></div>
            </div>
        `;

        this.fetchAndRenderPages();
        this.addEventListeners();
    }

    addEventListeners() {
        const statifyButton = this.querySelector('#statify-button');
        statifyButton.addEventListener('click', () => this.triggerStatification());
    }

    triggerStatification() {
        const statusDiv = this.querySelector('#statify-status');
        statusDiv.innerHTML = 'Starting statification...';

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
            statusDiv.innerHTML = 'Please select at least one page.';
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
            statusDiv.innerHTML = `Success: ${data.message}`;
        })
        .catch(error => {
            statusDiv.innerHTML = `Error: ${error.message}. Is the ssg-webhook service running?`;
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
                        console.log('StatifyElement: Received page items from Liferay API:', data.items);

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
                                checkbox.dataset.friendlyUrlPath = page.friendlyUrlPath;

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
            setTimeout(() => this.fetchAndRenderPages(), 100);
        }
    }
}

customElements.define('statify-element', StatifyElement);
