import type { CheerioAPI } from "cheerio";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { json, write } from "./util.js";

const literal = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");
export function bindCommerceMarkup($: CheerioAPI, binding: any, source: any) {
  const portrait = binding.products.find((p: any) => p.kind === "portrait");
  const form = $("[data-s2s-product]");
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const path = href.split(/[?#]/)[0];
    if (path === `/products/${portrait.sourceHandle}`)
      $(el).attr("href", `/products/${portrait.handle}${href.slice(path.length)}`);
  });
  $(".cart-count-badge").html("{{ cart.item_count }}");
  if (!form.length) return;
  form
    .attr(
      "data-s2s-commerce",
      "{% if product != blank %}true{% else %}false{% endif %}",
    )
    .attr("action", "{{ routes.cart_add_url }}")
    .attr("method", "post")
    .attr("enctype", "multipart/form-data")
    .attr("novalidate", "novalidate");
  form
    .find("#s2s-variants")
    .html(
      "{% if product != blank %}{{ product.variants | json }}{% else %}[]{% endif %}",
    );
  form
    .find("[data-s2s-disabled-commerce]")
    .removeAttr("data-s2s-disabled-commerce");
  form
    .find('[data-step="4"] button[type="submit"]')
    .attr("type", "button")
    .attr("data-show-step", "5")
    .html("{{ 's2s.review' | t }}");
  form
    .find('input[type="file"]')
    .removeAttr("data-s2s-local-file")
    .attr("data-s2s-file", "true")
    .attr("accept", "image/jpeg,image/png,image/webp");
  form.find('input[type="text"]').attr("maxlength", "80");
  form.find('[data-review="note"]').remove();
  form
    .find('[data-review="add-ons"] > div')
    .prepend("<p data-s2s-addon-summary></p>");
  form.find('[data-review="add-ons"] h5').remove();
  form.find('[data-review="photo-1"] img').attr("alt", "Selected pet photo");
  const addons = binding.products.filter((p: any) => p.kind === "addon");
  for (const addon of addons) {
    form
      .find("#" + addon.selector)
      .removeAttr("disabled title")
      .attr("data-s2s-addon", addon.handle)
      .attr("value", "")
      .removeAttr("data-price");
    form.append(
      `<script type="application/json" data-s2s-addon-product="${addon.handle}">{{ all_products['${addon.handle}'].variants | json }}</script>`,
    );
  }
  const galleries = Object.fromEntries(
    source.variants.map((v: any) => [
      JSON.stringify(v.options),
      v.featured_image?.position || 1,
    ]),
  );
  form.append(
    `<script type="application/json" data-s2s-gallery>${literal(galleries)}</script>`,
  );
  form.append('<input type="hidden" name="quantity" value="1">');
  form.append("<p class=\"small text-muted\">{{ 's2s.upload_hint' | t }}</p>");
  form.find("[data-s2s-status]").attr("tabindex", "-1");
  form
    .find(".product-price-final")
    .html(
      "{% if product != blank %}{{ product.selected_or_first_available_variant.price | money }}{% endif %}",
    )
    .removeAttr("data-variant-id data-current-variant-price");
  $(".product-price-compare").html(
    "{% if product != blank %}{{ product.selected_or_first_available_variant.compare_at_price | money }}{% endif %}",
  );
}

export const commerceLocales = {
  review: "Review details →",
  quantity_follows: "Quantity matches your portrait.",
  selected_photo: "Selected pet photo",
  photo_unconfirmed: "Photo storage was not confirmed. Please try again.",
  upload_hint:
    "JPG, PNG or WebP, up to 10 MB. Your photo and pet name are attached to this portrait in your cart.",
  cart: "Your cart",
  empty: "Your cart is empty.",
  continue: "Continue shopping",
  quantity: "Quantity",
  remove: "Remove",
  update: "Update cart",
  subtotal: "Subtotal",
  shipping: "Shipping and taxes calculated at checkout.",
  checkout: "Checkout",
  photo: "View uploaded photo",
  processing: "Adding your portrait…",
  invalid_photo: "Choose a JPG, PNG or WebP photo up to 10 MB.",
  required: "Add a pet name and photo to continue.",
  unavailable: "This combination is unavailable. Choose another option.",
  preview:
    "Open the imported product in your Shopify draft to add it to your cart.",
  failed:
    "Could not add your portrait. Your selections have been kept. Please try again.",
  uncertain:
    "Please check your cart before trying again; the network connection was interrupted.",
  cart_failed: "Could not update your cart. Please reload and try again.",
  no_addons: "No extras selected",
  addon: "Optional portrait service",
  previous_image: "Previous image",
  next_image: "Next image",
  product_images: "Product images",
  free_shipping: "Free shipping over $100",
  next: "Next",
  satisfaction_guarantee: "100% Artwork Satisfaction Guarantee",
  upload_photo: "Upload your pet photo",
  upload_photo_label: "Upload Pet Photo:",
  drop_photo: "Drag and drop your pet's photo or",
  browse: "Browse",
  family_upload_hint:
    "JPG, PNG or WebP · maximum 10 MB. Our team will contact you if the photo cannot be used.",
  photo_guidance: "Photo guidance",
  accessory_remove_notice:
    "All accessories such as leash, collar, and harness, will be REMOVED from your portrait. At this time, we are unable to accommodate any special requests.",
  photo_criteria_notice:
    "If your photo doesn’t meet our criteria, our team will reach out to you and help you find a more suitable photo.",
  photo_tips_intro: "For quick tips on photos,",
  photo_tips_link: "click here",
  any_extras: "Any Extras?",
  priority_addon: "Want your order sooner?",
  priority_addon_help: "We'll move your illustration to the front of the line!",
  digital_addon: "Digital Download",
  digital_addon_help: "Receive a file of your artwork to share and print extras.",
  santa_addon: "Add A Santa Hat",
  santa_addon_help: "Add a Santa hat to your artwork.",
  sleeve_name_addon: "Add Pet Name on Sleeve?",
  sleeve_name_addon_help: "We'll add your pet's name to the sleeve.",
  purchase_assurances: "Purchase assurances",
  delivery_window: "Delivers within 1-2 weeks",
  satisfaction_short: "100% Satisfaction Guarantee",
  shipping_threshold: "Free shipping on $100+ USD",
  pet_name: "Pet name",
  add_to_cart: "Add to cart",
  sold_out: "Sold out",
  collection_shop_now: "Shop Now",
  collection_from: "From",
  collection_empty: "No products are assigned to this collection yet.",
  collection_rating: "{{ rating }} out of 5 stars, {{ count }} reviews",
};

export async function writeCommerceTheme(out: string) {
  const theme = join(out, "theme"),
    src = dirname(fileURLToPath(import.meta.url));
  const cartText = Object.keys(commerceLocales)
    .map(
      (key) =>
        `${JSON.stringify(key)}:{{ ${JSON.stringify(`s2s.${key}`)} | t | json }}`,
    )
    .join(",");
  for (const file of ["commerce.js", "commerce.css"])
    await write(
      join(theme, "assets", "s2s-" + file),
      await readFile(join(src, file)),
    );
  await write(
    join(theme, "sections/s2s-cart.liquid"),
    `{{ 's2s-commerce.css' | asset_url | stylesheet_tag }}
<script type="application/json" data-s2s-commerce-config>{"root":{{ routes.root_url | json }},"currency":{{ cart.currency.iso_code | default: shop.currency | json }},"shopify":true,"text":{${cartText}}}</script>
<script src="{{ 's2s-commerce.js' | asset_url }}" defer></script>
<section class="s2s-cart container py-10">
<h1>{{ 's2s.cart' | t }}</h1>
{% if cart.empty? %}<p>{{ 's2s.empty' | t }}</p><a class="btn btn-primary" href="{{ routes.root_url }}">{{ 's2s.continue' | t }}</a>
{% else %}
<form action="{{ routes.cart_url }}" method="post" data-s2s-cart>
{% for item in cart.items %}
<article class="s2s-cart-item" data-key="{{ item.key | escape }}" data-group="{{ item.properties._s2s_group | escape }}" data-role="{{ item.properties._s2s_role | escape }}">
{% if item.image %}{{ item.image | image_url: width: 240 | image_tag: loading: 'lazy', widths: '120,240', sizes: '120px' }}{% endif %}
<div><h2><a href="{{ item.url }}">{{ item.product.title | escape }}</a></h2>{% unless item.product.has_only_default_variant %}<p>{{ item.variant.title | escape }}</p>{% endunless %}
<dl>{% for property in item.properties %}{% assign first_char = property.first | slice: 0 %}{% if property.last != blank and first_char != '_' %}<dt>{{ property.first | escape }}</dt><dd>{% assign url_prefix = property.last | slice: 0, 8 %}{% assign relative_prefix = property.last | slice: 0, 2 %}{% if property.last contains '/uploads/' %}{% if url_prefix == 'https://' or relative_prefix == '//' %}<a href="{{ property.last | escape }}" target="_blank" rel="noopener">{{ 's2s.photo' | t }}</a>{% else %}{{ property.last | escape }}{% endif %}{% else %}{{ property.last | escape }}{% endif %}</dd>{% endif %}{% endfor %}</dl>
<label for="quantity-{{ forloop.index }}">{{ 's2s.quantity' | t }}</label><input id="quantity-{{ forloop.index }}" type="number" min="0" max="99" value="{{ item.quantity }}" name="updates[]" data-s2s-quantity {% if item.properties._s2s_role == 'addon' %}readonly aria-describedby="quantity-note-{{ forloop.index }}"{% else %}required{% endif %}>
{% if item.properties._s2s_role == 'addon' %}<p class="small" id="quantity-note-{{ forloop.index }}">{{ 's2s.quantity_follows' | t }}</p>{% endif %}
<button type="button" class="btn btn-link" data-s2s-remove>{{ 's2s.remove' | t }}</button></div>
<strong>{{ item.final_line_price | money_with_currency }}</strong></article>
{% endfor %}
<div class="s2s-cart-total"><p>{{ 's2s.subtotal' | t }} <strong>{{ cart.total_price | money_with_currency }}</strong></p><p>{{ 's2s.shipping' | t }}</p>
<button type="submit" name="update" class="btn btn-outline-primary">{{ 's2s.update' | t }}</button>
<button type="submit" name="checkout" class="btn btn-primary">{{ 's2s.checkout' | t }}</button></div>
<p role="status" data-s2s-cart-status></p></form>{% endif %}</section>
{% schema %}{"name":"Cart","settings":[]}{% endschema %}`,
  );
  await json(join(theme, "templates/cart.json"), {
    sections: { main: { type: "s2s-cart", settings: {} } },
    order: ["main"],
  });
  await write(
    join(theme, "sections/s2s-addon.liquid"),
    `<section class="container py-10"><h1>{{ product.title | escape }}</h1><p>{{ 's2s.addon' | t }}</p><a href="{{ routes.root_url }}">{{ 's2s.continue' | t }}</a></section>{% schema %}{"name":"Portrait add-on","settings":[]}{% endschema %}`,
  );
  await json(join(theme, "templates/product.s2s-addon.json"), {
    sections: { main: { type: "s2s-addon", settings: {} } },
    order: ["main"],
  });
}
