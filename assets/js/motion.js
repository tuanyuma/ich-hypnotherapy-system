/**
 * motion.js — Mesin animasi 60fps berbasis GSAP 3.12.5 dengan fallback CSS otomatis
 * dan penghormatan penuh terhadap prefers-reduced-motion.
 */

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getGsap() {
  return typeof window !== 'undefined' && window.gsap ? window.gsap : null;
}

export function animatePageEnter(el) {
  if (!el || prefersReducedMotion()) return;
  const gsap = getGsap();
  if (gsap) {
    gsap.killTweensOf(el);
    gsap.fromTo(
      el,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.26, ease: 'power2.out', clearProps: 'transform,opacity' }
    );
  } else {
    el.classList.remove('page-enter-anim');
    void el.offsetWidth;
    el.classList.add('page-enter-anim');
  }
}

export function animateBentoStagger(container) {
  if (!container || prefersReducedMotion()) return;
  const gsap = getGsap();
  const targets = container.querySelectorAll('.hero-bento, .kpi-card, .card, .context-panel');
  if (!targets.length) return;

  if (gsap) {
    gsap.killTweensOf(targets);
    gsap.fromTo(
      targets,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.30,
        stagger: 0.038,
        ease: 'power2.out',
        clearProps: 'transform,opacity'
      }
    );
  }
}

export function animateModalOpen(modalRoot) {
  if (!modalRoot || prefersReducedMotion()) return;
  const panel = modalRoot.querySelector('.modal-panel');
  const gsap = getGsap();
  if (gsap && panel) {
    gsap.killTweensOf([modalRoot, panel]);
    gsap.fromTo(modalRoot, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power1.out' });
    gsap.fromTo(
      panel,
      { opacity: 0, scale: 0.95, y: 16 },
      { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: 'power3.out', clearProps: 'transform,opacity' }
    );
  }
}

export function animateModalClose(modalRoot, onDone) {
  if (!modalRoot || prefersReducedMotion()) {
    if (onDone) onDone();
    return;
  }
  const panel = modalRoot.querySelector('.modal-panel');
  const gsap = getGsap();
  if (gsap && panel) {
    gsap.to(panel, { opacity: 0, scale: 0.96, y: 10, duration: 0.14, ease: 'power2.in' });
    gsap.to(modalRoot, {
      opacity: 0,
      duration: 0.15,
      ease: 'power1.in',
      onComplete: () => {
        modalRoot.style.opacity = '';
        if (onDone) onDone();
      }
    });
  } else if (onDone) {
    onDone();
  }
}

export function animateRowRemove(rowEl) {
  return new Promise((resolve) => {
    if (!rowEl || prefersReducedMotion()) {
      resolve();
      return;
    }
    const gsap = getGsap();
    if (gsap) {
      gsap.to(rowEl, {
        opacity: 0,
        x: 24,
        duration: 0.24,
        ease: 'power2.in',
        onComplete: resolve
      });
    } else {
      rowEl.style.transition = 'opacity 180ms ease, transform 180ms ease';
      rowEl.style.opacity = '0';
      rowEl.style.transform = 'translateX(20px)';
      setTimeout(resolve, 190);
    }
  });
}

export function animateRowHighlight(rowEl) {
  if (!rowEl || prefersReducedMotion()) return;
  rowEl.classList.remove('row-flash');
  void rowEl.offsetWidth;
  rowEl.classList.add('row-flash');
}
