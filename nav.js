(function() {
    const navItems = [
        { href: 'index.html', label: 'Home' },
        { section: 'Understand' },
        { href: 'spec-driven-development.html', label: 'Spec-Driven Development' },
        { href: 'what-the-model-knows.html', label: 'What the Model Knows' },
        { href: 'vibe-coding-vs-spec-driven.html', label: 'Vibe vs Spec' },
        { href: 'solution-space.html', label: 'The Solution Space' },
        { href: 'telephone-game.html', label: 'The Telephone Game' },
        { href: 'abstraction-paradox.html', label: 'The Abstraction Paradox' },
        { section: 'Approach Library' },
        { href: 'matrix-methodology.html', label: 'The Matrix' },
        { href: 'ralph-wiggum.html', label: 'Ralph Loop' },
        { href: 'gsd.html', label: 'GSD' },
        { href: 'bmad.html', label: 'BMAD' },
        { section: 'Thought Experiments' },
        { href: 'specs-as-dna.html', label: 'Specs as DNA' },
        { href: 'code-diffusion-model.html', label: 'Code Diffusion Model' },
        { href: 'fuzzy-compiler.html', label: 'Fuzzy Compiler' },
        { section: 'Concepts' },
        { href: 'continuous-evolution.html', label: 'Continuous Evolution' }
    ];

    const currentPage = location.pathname.split('/').pop() || 'index.html';

    const listItems = navItems.map(item => {
        if (item.section) {
            return `<li class="nav-section-label">${item.section}</li>`;
        }
        const active = item.href === currentPage ? ' class="active"' : '';
        return `<li><a href="${item.href}"${active}>${item.label}</a></li>`;
    }).join('\n                ');

    const navHTML = `
    <nav>
        <div class="nav-container">
            <a href="index.html" class="logo">
                <span class="logo-icon">🍅</span>
                <span>Humble Tomato</span>
            </a>
            <button class="menu-toggle" aria-label="Toggle menu">☰</button>
            <ul class="nav-links">
                ${listItems}
            </ul>
        </div>
    </nav>`;

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
