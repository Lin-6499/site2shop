/* Site2Shop runtime: UI-only adapters. No original merchant scripts or credentials. */
(() => {
  const instances = new WeakMap();
  const money = (v) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: window.Shopify?.currency?.active || "USD",
    }).format(v / 100);
  const observe = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("entered");
          entry.target
            .querySelectorAll(".animate__animated.opacity-0")
            .forEach((el) => {
              el.classList.remove("opacity-0");
              if (el.dataset.animateClass)
                el.classList.add(el.dataset.animateClass);
            });
        }
      }),
    { rootMargin: "0px 0px -100px 0px" },
  );
  function init(root = document) {
    root.querySelectorAll(".offcanvas[id]").forEach((panel) => {
      if (panel.dataset.s2sOffcanvasReady) return;
      panel.dataset.s2sOffcanvasReady = "true";
      const triggers = () =>
        document.querySelectorAll(`[aria-controls="${panel.id}"]`);
      panel.addEventListener("show.bs.offcanvas", () =>
        triggers().forEach((trigger) => trigger.setAttribute("aria-expanded", "true")),
      );
      panel.addEventListener("shown.bs.offcanvas", () => {
        const focusTarget = panel.querySelector(
          'input:not([type="hidden"]),button:not([disabled]),a[href]',
        );
        focusTarget?.focus({ preventScroll: true });
      });
      panel.addEventListener("hidden.bs.offcanvas", () =>
        triggers().forEach((trigger) => trigger.setAttribute("aria-expanded", "false")),
      );
    });
    root.querySelectorAll(".enter-view").forEach((el) => observe.observe(el));
    root.querySelectorAll(".product-media-gallery").forEach((gallery) => {
      const mainEl = gallery.querySelector(".main-splide"),
        thumbEl = gallery.querySelector(".thumbs-splide");
      if (!mainEl || !thumbEl || instances.has(mainEl) || !window.Splide)
        return;
      const main = new Splide(mainEl, {
        type: "fade",
        rewind: true,
        pagination: false,
        arrows: true,
      });
      const thumbs = new Splide(thumbEl, {
        gap: 12,
        rewind: true,
        arrows: false,
        pagination: false,
        perPage: 5,
        isNavigation: true,
        breakpoints: { 575: { perPage: 3 } },
      });
      main.sync(thumbs);
      main.mount();
      thumbs.mount();
      instances.set(mainEl, main);
      instances.set(thumbEl, thumbs);
      gallery.classList.add("init");
    });
    root.querySelectorAll(".splide").forEach((el) => {
      if (instances.has(el) || !window.Splide) return;
      const d = el.dataset;
      let options = {
        rewind: true,
        arrows: d.arrows !== "false",
        pagination: d.pagination === "true",
        speed: Number(d.speed) || 500,
        easing: d.easing || "cubic-bezier(.42,.65,.27,.99)",
        autoplay: d.autoplay === "true",
        interval: Number(d.interval) || 6000,
      };
      if (d.breakpointXs) {
        options = {
          ...options,
          mediaQuery: "min",
          perPage: Number(d.breakpointXs),
          padding: el.classList.contains("splide-products")
            ? "10%"
            : { right: "3rem" },
          breakpoints: Object.fromEntries(
            [
              [576, "Sm"],
              [768, "Md"],
              [992, "Lg"],
              [1200, "Xl"],
              [1400, "Xxl"],
            ].map(([w, s]) => [
              w,
              { perPage: Number(d["breakpoint" + s]) || 1, padding: 0 },
            ]),
          ),
        };
      } else if (el.className.includes("thumb"))
        options = {
          ...options,
          arrows: false,
          pagination: false,
          isNavigation: true,
          fixedWidth: 80,
          gap: 10,
        };
      else options = { ...options, perPage: 1, pagination: false };
      try {
        const splide = new Splide(el, options);
        splide.mount();
        if (!options.autoplay) splide.Components.Autoplay?.pause();
        instances.set(el, splide);
        el.classList.add("init");
        if (el.classList.contains("splide-products")) {
          const align = () => {
            const img = el.querySelector(".product-img");
            if (img)
              el.querySelectorAll(".splide__arrow").forEach((a) => {
                a.style.top = img.clientHeight / 2 + "px";
                a.style.transform = "translateY(-25%)";
              });
          };
          el.querySelectorAll("img").forEach((img) =>
            img.addEventListener("load", align, { once: true }),
          );
          align();
          splide.on("resized", align);
        }
      } catch (e) {
        console.warn("S2S slider:", e.message);
      }
    });
    root.querySelectorAll(".carousel").forEach((el) => {
      if (!window.bootstrap?.Carousel) return;
      const autoplay =
        el.dataset.bsRide === "carousel" &&
        el.dataset.bsInterval !== "false";
      if (!autoplay) el.removeAttribute("data-bs-ride");
      const carousel = window.bootstrap.Carousel.getOrCreateInstance(
        el,
        autoplay ? undefined : { interval: false, ride: false },
      );
      if (!autoplay) carousel.pause();
    });
    root.querySelectorAll("[data-s2s-product]").forEach((form) => {
      if (form.hasAttribute("data-s2s-commerce")) return;
      if (form.dataset.s2sReady) return;
      form.dataset.s2sReady = "true";
      let variants = [];
      try {
        variants = JSON.parse(
          form.querySelector("#s2s-variants")?.textContent || "[]",
        );
      } catch {}
      const status = form.querySelector("[data-s2s-status]");
      const update = () => {
        const opts = [
          "option-background-color",
          "option-size",
          "option-frame-option",
        ].map(
          (name) => form.querySelector(`input[name="${name}"]:checked`)?.value,
        );
        if (form.querySelector("#framing-swicher-no-frame:checked"))
          opts[2] = "Poster-Only";
        const variant = variants.find((v) =>
          v.options?.every((o, i) => !opts[i] || o === opts[i]),
        );
        if (variant) {
          form.querySelector("[data-s2s-variant]").value = variant.id;
          document
            .querySelectorAll(".product-price-final,.form-subtotal-price")
            .forEach((el) => {
              el.textContent = money(variant.price);
            });
          form
            .querySelectorAll(".form-total-price,.product-subtotal")
            .forEach((el) => {
              el.textContent = money(variant.price);
            });
          const gallery = document.querySelector(".main-splide");
          if (gallery && variant.featured_image?.position)
            instances.get(gallery)?.go(variant.featured_image.position - 1);
        }
        form
          .querySelectorAll("#form-option-framing-collapse-frame")
          .forEach((el) =>
            el.classList.toggle("show", opts[2] !== "Poster-Only"),
          );
        form
          .querySelectorAll("#form-option-framing-collapse-no-frame")
          .forEach((el) =>
            el.classList.toggle("show", opts[2] === "Poster-Only"),
          );
      };
      form.addEventListener("change", update);
      form.querySelectorAll("[data-show-step]").forEach((button) =>
        button.addEventListener("click", () => {
          const current = button.closest("[data-step]");
          const target = button.dataset.showStep;
          if (
            Number(target) > Number(current?.dataset.step) &&
            Number(current?.dataset.step) >= 3
          ) {
            status.textContent =
              "Phase 1 preview: durable photo uploads and order placement will be connected in phase 2.";
            return;
          }
          form.querySelectorAll("[data-step]").forEach((step) => {
            step.style.display = step.dataset.step === target ? "" : "none";
          });
          update();
        }),
      );
      form.querySelectorAll('input[type="file"]').forEach((input) =>
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          let preview = form.querySelector("[data-s2s-file-preview]");
          if (!preview) {
            preview = document.createElement("div");
            preview.dataset.s2sFilePreview = "";
            input.after(preview);
          }
          preview.replaceChildren();
          const label = document.createElement("p");
          label.textContent = file.name + " — local preview only";
          preview.append(label);
          if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
            const img = document.createElement("img");
            const url = URL.createObjectURL(file);
            img.src = url;
            img.alt = "Selected pet photo";
            img.style.maxWidth = "150px";
            img.onload = () => URL.revokeObjectURL(url);
            preview.append(img);
          }
        }),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        status.textContent =
          "Ordering is unavailable in this phase 1 reference preview. Connect target variants and the upload service in phase 2.";
      });
      update();
    });
    root
      .querySelectorAll("form:not([role=search]):not([data-s2s-product]):not([data-s2s-cart]):not(.s2s-family-form):not(.s2s-portrait-form)")
      .forEach((form) => {
        if (form.dataset.s2sReady) return;
        form.dataset.s2sReady = "true";
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          let note = form.querySelector("[data-s2s-note]");
          if (!note) {
            note = document.createElement("p");
            note.dataset.s2sNote = "";
            note.setAttribute("role", "status");
            form.append(note);
          }
          note.textContent = "This form requires a target-store integration.";
        });
      });
    // Match the observed announcement placement in the desktop mega menu.
    if (innerWidth >= 1200) {
      const announcement = document.querySelector(
        "#offcanvas-nav-announcements",
      );
      const col = document.querySelector(".dropdown-megamenu .col-5");
      if (announcement && col) {
        announcement.classList.remove("mb-8");
        announcement.classList.add("mb-4");
        col.prepend(announcement);
      }
    }
  }
  document.addEventListener("DOMContentLoaded", () => init());
  document.addEventListener("s2s:variant", (event) => {
    const gallery = document.querySelector(".main-splide");
    if (gallery) instances.get(gallery)?.go(event.detail.position - 1);
  });
  document.addEventListener("shopify:section:load", (e) => init(e.target));
  document.addEventListener("shopify:section:unload", (e) => {
    e.target.querySelectorAll(".splide").forEach((el) => {
      instances.get(el)?.destroy();
      instances.delete(el);
    });
    e.target
      .querySelectorAll(".enter-view")
      .forEach((el) => observe.unobserve(el));
  });
  addEventListener(
    "scroll",
    () => {
      document.documentElement.classList.toggle("scrolled", scrollY > 0);
      for (const [id, large, small] of [
        ["header-row-desktop", "py-6", "py-4"],
        ["header-row-mobile", "py-4", "py-3"],
      ]) {
        const el = document.getElementById(id);
        el?.classList.toggle(large, scrollY === 0);
        el?.classList.toggle(small, scrollY > 0);
      }
    },
    { passive: true },
  );
})();
