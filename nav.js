(function() {
    // Two top-level sections. Every content page belongs to exactly one of them;
    // index.html is the root hub and belongs to neither.
    const sections = [
        {
            id: 'ai-tips',
            label: 'AI Tips',
            icon: '🤖',
            home: 'ai-tips.html',
            items: [
                { href: 'ai-tips.html', label: 'Overview' },
                { section: 'Understand' },
                { href: 'spec-driven-development.html', label: 'Spec-Driven Development' },
                { href: 'what-the-model-knows.html', label: 'What the Model Knows' },
                { href: 'vibe-coding-vs-spec-driven.html', label: 'Vibe vs Spec' },
                { href: 'solution-space.html', label: 'The Solution Space' },
                { href: 'telephone-game.html', label: 'The Telephone Game' },
                { href: 'abstraction-paradox.html', label: 'The Abstraction Paradox' },
                { section: 'Approach Library' },
                { href: 'matrix-methodology.html', label: 'Context Matrix' },
                { href: 'ralph-wiggum.html', label: 'Ralph Loop' },
                { href: 'gsd.html', label: 'GSD' },
                { href: 'bmad.html', label: 'BMAD' },
                { section: 'Thought Experiments' },
                { href: 'specs-as-dna.html', label: 'Specs as DNA' },
                { href: 'code-diffusion-model.html', label: 'Code Diffusion Model' },
                { href: 'fuzzy-compiler.html', label: 'Fuzzy Compiler' },
                { section: 'Concepts' },
                { href: 'continuous-evolution.html', label: 'Continuous Evolution' }
            ]
        },
        {
            id: 'ios-games',
            label: 'iOS Games',
            icon: '🎮',
            home: 'ios-games.html',
            comingSoon: true,
            items: [
                { href: 'ios-games.html', label: 'Overview' }
            ]
        }
    ];

    const currentPage = location.pathname.split('/').pop() || 'index.html';
    const isHub = currentPage === 'index.html';

    // Pages not listed in any section (older one-offs like tools-landscape.html)
    // still belong to AI Tips — fall back to it rather than showing no sidebar.
    const explicit = sections.find(s => s.items.some(i => i.href === currentPage));
    const currentSection = isHub ? null : (explicit || sections[0]);

    const switcherHTML = sections.map(s => {
        const active = currentSection && s.id === currentSection.id ? ' active' : '';
        const soon = s.comingSoon ? '<span class="section-tab-soon">Soon</span>' : '';
        return `<a href="${s.home}" class="section-tab${active}">` +
               `<span class="section-tab-icon">${s.icon}</span>` +
               `<span class="section-tab-label">${s.label}</span>${soon}</a>`;
    }).join('\n                    ');

    const listItems = currentSection ? currentSection.items.map(item => {
        if (item.section) {
            return `<li class="nav-section-label">${item.section}</li>`;
        }
        const active = item.href === currentPage ? ' class="active"' : '';
        return `<li><a href="${item.href}"${active}>${item.label}</a></li>`;
    }).join('\n                ') : '';

    // The sidebar is a sibling of <nav>, not a child. Nesting a position:fixed
    // element inside the fixed top bar makes Safari attach it to the bar's
    // compositing layer, where it drifts or disappears while scrolling.
    const navHTML = `
    <nav>
        <div class="nav-container">
            <a href="index.html" class="logo">
                <span class="logo-icon">🍅</span>
                <span>Humble Tomato</span>
            </a>
            <button class="menu-toggle" aria-label="Toggle menu">☰</button>
        </div>
    </nav>
    <ul class="nav-links">
        <li class="nav-switcher">
            ${switcherHTML}
        </li>
        ${listItems}
    </ul>`;

    // The hub has no sidebar, so its content is centred full-width instead of offset.
    if (isHub) {
        document.body.classList.add('no-sidebar');
    }

    // Replace the existing nav or insert at start of body
    const existingNav = document.querySelector('nav');
    if (existingNav) {
        existingNav.outerHTML = navHTML;
    } else {
        document.body.insertAdjacentHTML('afterbegin', navHTML);
    }

    // Wire up mobile menu toggle
    document.querySelector('.menu-toggle').addEventListener('click', function() {
        document.querySelector('.nav-links').classList.toggle('active');
    });
})();
