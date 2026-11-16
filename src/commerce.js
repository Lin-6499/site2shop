(() => {
  const config = JSON.parse(
    document.querySelector("#s2s-commerce-config, [data-s2s-commerce-config]")
      ?.textContent || "{}",
  );
  const t = (key) => config.text?.[key] || key;
  const root = config.root || "/";
  const money = (cents) =>
    new Intl.NumberFormat(document.documentElement.lang || "en", {
      style: "currency",
      currency: config.currency || "USD",
    }).format(cents / 100);
  async function request(path, options) {
    const response = await fetch(root + path, {
      credentials: "same-origin",
      ...options,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.description || data.message || t("failed"));
    return data;
  }
  const post = (path, data) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  function init(scope = document) {
    scope.querySelectorAll("[data-s2s-commerce]").forEach((form) => {
      if (form.dataset.commerceReady) return;
      form.dataset.commerceReady = "true";
      const read = (selector) =>
        JSON.parse(form.querySelector(selector)?.textContent || "null");
      const variants = read("#s2s-variants") || [];
      const galleries = read("[data-s2s-gallery]") || {};
      const status = form.querySelector("[data-s2s-status]");
      const fileInput = form.querySelector("[data-s2s-file]");
      const nameInput = form.querySelector("#input-pet-name-1");
      let selected,
        busy = false,
        previewUrl,
        group = crypto.randomUUID();
      const extraInputs = [...form.querySelectorAll("[data-s2s-addon]")];
      for (const input of extraInputs) {
        const variant = read(
          `[data-s2s-addon-product="${input.dataset.s2sAddon}"]`,
        )?.[0];
        input.disabled = !variant?.available;
        input.value = variant?.id || "";
        input.dataset.price = variant?.price || "0";
        const label = form.querySelector(`label[for="${input.id}"]`);
        const price = label?.querySelector(".money");
        if (price && variant) price.textContent = money(variant.price);
      }
      const show = (step) => {
        form
          .querySelectorAll("[data-step]")
          .forEach(
            (el) =>
              (el.style.display =
                el.dataset.step === String(step) ? "" : "none"),
          );
        const heading = form.querySelector(`[data-step="${step}"] h4`);
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
      };
      const say = (message) => {
        status.textContent = message;
        status.focus({ preventScroll: true });
      };
      const validPhoto = () => {
        const file = fileInput.files?.[0];
        return (
          !!file &&
          /^(image\/jpeg|image\/png|image\/webp)$/.test(file.type) &&
          file.size > 0 &&
          file.size <= 10 * 1024 * 1024
        );
      };
      const validate = () => {
        if (!nameInput.value.trim() || !fileInput.files?.length) {
          show(3);
          say(t("required"));
          (!nameInput.value.trim() ? nameInput : fileInput).focus();
          return false;
        }
        if (!validPhoto()) {
          show(3);
          say(t("invalid_photo"));
          fileInput.focus();
          return false;
        }
        if (!selected?.available) {
          show(2);
          say(t("unavailable"));
          return false;
        }
        return true;
      };
      const update = () => {
        const options = [
          "option-background-color",
          "option-size",
          "option-frame-option",
        ].map(
          (name) => form.querySelector(`input[name="${name}"]:checked`)?.value,
        );
        if (form.querySelector("#framing-swicher-no-frame:checked"))
          options[2] = "Poster-Only";
        selected = variants.find((v) =>
          v.options?.every((o, i) => o === options[i]),
        );
        form.querySelector("[data-s2s-variant]").value = selected?.id || "";
        const extra = extraInputs
          .filter((el) => el.checked && !el.disabled)
          .reduce((sum, el) => sum + Number(el.dataset.price), 0);
        const total = selected ? money(selected.price + extra) : "—";
        form
          .querySelectorAll(
            ".product-price-final,.form-subtotal-price,.form-total-price,.product-subtotal",
          )
          .forEach((el) => (el.textContent = total));
        document
          .querySelectorAll(
            "#product-content-area > .product-price-container .product-price-final",
          )
          .forEach(
            (el) => (el.textContent = selected ? money(selected.price) : "—"),
          );
        document.querySelectorAll(".product-price-compare").forEach((el) => {
          const onSale = selected?.compare_at_price > selected?.price;
          el.textContent = onSale ? money(selected.compare_at_price) : "";
          el.hidden = !onSale;
          el.style.display = onSale ? "" : "none";
        });
        form
          .querySelectorAll('button[type="submit"]')
          .forEach((el) => (el.disabled = busy || !selected?.available));
        form
          .querySelector("#form-option-framing-collapse-frame")
          ?.classList.toggle("show", options[2] !== "Poster-Only");
        form
          .querySelector("#form-option-framing-collapse-no-frame")
          ?.classList.toggle("show", options[2] === "Poster-Only");
        for (const [key, value] of [
          ["background", options[0]],
          ["size", options[1]],
          ["framing", options[2]],
          ["photo-1", nameInput.value],
        ]) {
          const span = form.querySelector(`[data-review="${key}"] h5 span`);
          if (span) span.textContent = value || "";
        }
        form.querySelector("[data-s2s-addon-summary]").textContent =
          extraInputs
            .filter((el) => el.checked && !el.disabled)
            .map((el) =>
              form
                .querySelector(`label[for="${el.id}"]`)
                ?.textContent.trim()
                .replace(/\s+/g, " "),
            )
            .join(" · ") || t("no_addons");
        const position = galleries[JSON.stringify(options)];
        if (position)
          document.dispatchEvent(
            new CustomEvent("s2s:variant", { detail: { position } }),
          );
        return selected;
      };
      const params = new URLSearchParams(location.search);
      const initial = variants.find(
        (v) => String(v.id) === params.get("variant"),
      );
      if (initial) {
        [
          "option-background-color",
          "option-size",
          "option-frame-option",
        ].forEach((name, i) =>
          form
            .querySelectorAll(`input[name="${name}"]`)
            .forEach((el) => (el.checked = el.value === initial.options[i])),
        );
        if (initial.options[2] === "Poster-Only")
          form.querySelector("#framing-swicher-no-frame").checked = true;
      }
      form.addEventListener("change", (event) => {
        if (event.target !== fileInput) status.textContent = "";
        update();
      });
      nameInput.addEventListener("input", update);
      form.querySelectorAll("[data-show-step]").forEach((button) =>
        button.addEventListener("click", () => {
          if (busy) return;
          const current = Number(button.closest("[data-step]")?.dataset.step),
            target = Number(button.dataset.showStep);
          if (target > current && current >= 3 && !validate()) return;
          if (target > current && current === 2 && !selected?.available) {
            say(t("unavailable"));
            return;
          }
          status.textContent = "";
          update();
          show(target);
        }),
      );
      fileInput.addEventListener("change", () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        let preview = form.querySelector("[data-s2s-file-preview]");
        if (!preview) {
          preview = document.createElement("div");
          preview.dataset.s2sFilePreview = "";
          fileInput.after(preview);
        }
        preview.replaceChildren();
        if (!validPhoto()) {
          say(t("invalid_photo"));
          return;
        }
        previewUrl = URL.createObjectURL(fileInput.files[0]);
        const img = document.createElement("img");
        img.src = previewUrl;
        img.alt = nameInput.value || t("selected_photo");
        const name = document.createElement("p");
        name.textContent = fileInput.files[0].name;
        preview.append(img, name);
        form.querySelector('[data-review="photo-1"] img').src = previewUrl;
      });
      async function removeAttempt() {
        const cart = await request("cart.js");
        const updates = Object.fromEntries(
          cart.items
            .filter((i) => i.properties?._s2s_group === group)
            .map((i) => [i.key, 0]),
        );
        if (Object.keys(updates).length)
          await post("cart/update.js", { updates });
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        if (form.dataset.s2sCommerce !== "true" || !config.shopify) {
          say(t("preview"));
          return;
        }
        if (!validate()) return;
        busy = true;
        form.setAttribute("aria-busy", "true");
        update();
        say(t("processing"));
        const checkout = event.submitter?.dataset.atcMode === "checkout";
        try {
          const existing = await request("cart.js");
          if (existing.items.some((i) => i.properties?._s2s_group === group))
            throw new Error(t("uncertain"));
          const data = new FormData();
          data.set("id", selected.id);
          data.set("quantity", "1");
          data.set("properties[Pet Name 1]", nameInput.value.trim());
          data.set("properties[Upload Pet Photo 1]", fileInput.files[0]);
          data.set("properties[_s2s_group]", group);
          data.set("properties[_s2s_role]", "portrait");
          const added = await request("cart/add.js", {
            method: "POST",
            body: data,
          });
          const photo = added.properties?.["Upload Pet Photo 1"];
          if (!photo || !/\/uploads\//.test(photo))
            throw new Error(t("photo_unconfirmed"));
          const items = extraInputs
            .filter((el) => el.checked && !el.disabled)
            .map((el) => ({
              id: Number(el.value),
              quantity: 1,
              properties: {
                "Pet Name 1": nameInput.value.trim(),
                "Upload Pet Photo 1": photo,
                _s2s_group: group,
                _s2s_role: "addon",
              },
            }));
          if (items.length) await post("cart/add.js", { items });
          const cart = await request("cart.js");
          const attempt = cart.items.filter(
            (i) => i.properties?._s2s_group === group,
          );
          if (
            attempt.length !== items.length + 1 ||
            attempt.some((i) => i.quantity !== 1)
          )
            throw new Error(t("uncertain"));
          location.assign(root + (checkout ? "checkout" : "cart"));
        } catch (error) {
          try {
            await removeAttempt();
            say(error.message || t("failed"));
            group = crypto.randomUUID();
          } catch {
            say(t("uncertain"));
            const link = document.createElement("a");
            link.href = root + "cart";
            link.textContent = " " + t("cart");
            status.append(link);
            return;
          }
          busy = false;
          form.removeAttribute("aria-busy");
          update();
        }
      });
      update();
    });
    scope.querySelectorAll("[data-s2s-cart]").forEach((form) => {
      if (form.dataset.commerceReady) return;
      form.dataset.commerceReady = "true";
      let busy = false;
      const rows = [...form.querySelectorAll("[data-key]")];
      const save = async (remove, checkout) => {
        if (busy) return;
        busy = true;
        form.setAttribute("aria-busy", "true");
        form.querySelectorAll("button").forEach((b) => (b.disabled = true));
        try {
          const updates = {};
          for (const row of rows) {
            const input = row.querySelector("[data-s2s-quantity]");
            if (
              remove !== row &&
              (!input.value.trim() || !input.checkValidity())
            ) {
              input.reportValidity();
              throw new Error(t("cart_failed"));
            }
            updates[row.dataset.key] = remove === row ? 0 : Number(input.value);
          }
          for (const parent of rows.filter(
            (r) => r.dataset.role === "portrait" && r.dataset.group,
          )) {
            for (const addon of rows.filter(
              (r) =>
                r.dataset.group === parent.dataset.group &&
                r.dataset.role === "addon",
            )) {
              if (remove === parent || updates[parent.dataset.key] === 0)
                updates[addon.dataset.key] = 0;
              else if (remove !== addon)
                updates[addon.dataset.key] = updates[parent.dataset.key];
            }
          }
          await post("cart/update.js", { updates });
          if (checkout) location.assign(root + "checkout");
          else location.reload();
        } catch (error) {
          form.querySelector("[data-s2s-cart-status]").textContent =
            error.message || t("cart_failed");
          busy = false;
          form.removeAttribute("aria-busy");
          form.querySelectorAll("button").forEach((b) => (b.disabled = false));
        }
      };
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        save(null, e.submitter?.name === "checkout");
      });
      for (const row of rows)
        row
          .querySelector("[data-s2s-remove]")
          .addEventListener("click", () => save(row, false));
    });
  }
  document.addEventListener("DOMContentLoaded", () => init());
  document.addEventListener("shopify:section:load", (e) => init(e.target));
})();
