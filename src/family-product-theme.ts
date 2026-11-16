import { productScrollStyles, type ProductScrollMode } from "./product-scroll-theme.js";

const schema = (name: string) =>
  `{% schema %}${JSON.stringify({ name, settings: [], blocks: [{ type: "@app" }], presets: [{ name }] })}{% endschema %}`;

type FamilySectionConfig = {
  name: string;
  marker: string;
  uploadProperty?: string;
  nameProperty?: string;
  nameRequired?: boolean;
  extras?: Array<{ handle: string; marker: string; label: string }>;
  showTrust?: boolean;
  scrollMode: ProductScrollMode;
  selectOptions?: string[];
  stepOptions?: boolean;
  hiddenQuantity?: boolean;
  visualOptions?: boolean;
  visualOptionNames?: string[];
  descriptionAfterForm?: boolean;
  descriptionDisclosure?: boolean;
};

export const familyProductSnippets = {
  "s2s-product-uploader": String.raw`{% doc %}
@param {string} section_id - Unique section identifier.
@param {string} family_key - Product-family presentation key.
@param {string} property_name - Line item property used for the uploaded photo.
@param {product} product - Product used for the initial hidden preview dimensions.
@param {string} [name_property] - Optional line item property used for the pet name.
@param {boolean} [name_required] - Whether the pet name is required.
{% enddoc %}
<div class="s2s-personalization" data-s2s-upload-dropzone data-family-key="{{ family_key | escape }}">
  <label class="s2s-upload-heading" for="s2s-photo-{{ section_id }}">{{ 's2s.upload_photo_label' | t }} <span aria-hidden="true">*</span></label>
  <label class="s2s-upload-surface" for="s2s-photo-{{ section_id }}" data-s2s-dropzone>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3"/></svg>
    <span>{{ 's2s.drop_photo' | t }} <span class="s2s-upload-browse">{{ 's2s.browse' | t }}</span></span>
  </label>
  <input class="visually-hidden" id="s2s-photo-{{ section_id }}" type="file" name="properties[{{ property_name | escape }}]" accept="image/jpeg,image/png,image/webp" required data-s2s-photo>
  {% assign selected_photo_alt = 's2s.selected_photo' | t %}<div class="s2s-photo-preview" data-s2s-photo-preview hidden>{% if product.featured_image %}{{ product.featured_image | image_url: width: 64, height: 64, crop: 'center' | image_tag: loading: 'lazy', alt: selected_photo_alt, class: 's2s-photo-image' }}{% endif %}<span data-s2s-photo-name></span></div>
  {% if name_property != blank %}<label for="s2s-name-{{ section_id }}">{{ name_property | escape }}</label><input id="s2s-name-{{ section_id }}" type="text" name="properties[{{ name_property | escape }}]" maxlength="40" autocomplete="off"{% if name_required %} required{% endif %}>{% endif %}
  <p class="s2s-upload-hint">{{ 's2s.family_upload_hint' | t }}</p>
  {% if family_key == 'accessory-product' %}
    <ul class="s2s-family-instructions" aria-label="{{ 's2s.photo_guidance' | t }}">
      <li><svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20"><rect x="1.5" y="1.5" width="17" height="17" rx="1" fill="#19ad31" stroke="#0a771a"/><path d="m5 10 3 3 7-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>{{ 's2s.accessory_remove_notice' | t }}</span></li>
      <li><svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20"><rect x="1.5" y="1.5" width="17" height="17" rx="1" fill="#19ad31" stroke="#0a771a"/><path d="m5 10 3 3 7-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>{{ 's2s.photo_criteria_notice' | t }}</span></li>
      <li><svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20"><rect x="1.5" y="1.5" width="17" height="17" rx="1" fill="#19ad31" stroke="#0a771a"/><path d="m5 10 3 3 7-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>{{ 's2s.photo_tips_intro' | t }} <a href="{{ pages['image-guidelines'].url | default: '/pages/image-guidelines' }}">{{ 's2s.photo_tips_link' | t }}</a>.</span></li>
    </ul>
  {% endif %}
</div>`,
  "s2s-product-addons": String.raw`{% doc %}
@param {string} section_id - Unique section identifier.
@param {boolean} [show_skip] - Show priority service.
@param {boolean} [show_digital] - Show digital download.
@param {boolean} [show_santa] - Show Santa hat service.
@param {boolean} [show_name] - Show sleeve name personalization.
@param {object} [s2s_preview_addons] - Local evidence-only add-on product bindings.
{% enddoc %}
<fieldset class="s2s-family-addons" data-s2s-addon-group>
  <legend>{{ 's2s.any_extras' | t }}</legend>
  {% if show_skip %}{% assign addon_product = s2s_preview_addons.skip_line | default: all_products['skip-the-line'] %}{% assign addon_variant = addon_product.selected_or_first_available_variant %}<div class="s2s-family-addon"><input id="s2s-addon-skip-line-{{ section_id }}" type="checkbox" value="{{ addon_variant.id }}" data-price="{{ addon_variant.price }}" data-s2s-addon="skip-the-line" data-s2s-addon-skip-line{% unless addon_variant.available %} disabled{% endunless %}><label for="s2s-addon-skip-line-{{ section_id }}"><span>{{ 's2s.priority_addon' | t }} <span class="money">{{ addon_variant.price | money }}</span></span><small>{{ 's2s.priority_addon_help' | t }}</small></label><script type="application/json" data-s2s-addon-product="skip-the-line">{{ addon_product.variants | json }}</script></div>{% endif %}
  {% if show_digital %}{% assign addon_product = s2s_preview_addons.digital_download | default: all_products['digital-download'] %}{% assign addon_variant = addon_product.selected_or_first_available_variant %}<div class="s2s-family-addon"><input id="s2s-addon-digital-download-{{ section_id }}" type="checkbox" value="{{ addon_variant.id }}" data-price="{{ addon_variant.price }}" data-s2s-addon="digital-download" data-s2s-addon-digital-download{% unless addon_variant.available %} disabled{% endunless %}><label for="s2s-addon-digital-download-{{ section_id }}"><span>{{ 's2s.digital_addon' | t }} <span class="money">{{ addon_variant.price | money }}</span></span><small>{{ 's2s.digital_addon_help' | t }}</small></label><script type="application/json" data-s2s-addon-product="digital-download">{{ addon_product.variants | json }}</script></div>{% endif %}
  {% if show_santa %}{% assign addon_product = s2s_preview_addons.santa_hat | default: all_products['add-a-santa-hat'] %}{% assign addon_variant = addon_product.selected_or_first_available_variant %}<div class="s2s-family-addon"><input id="s2s-addon-santa-hat-{{ section_id }}" type="checkbox" value="{{ addon_variant.id }}" data-price="{{ addon_variant.price }}" data-s2s-addon="add-a-santa-hat" data-s2s-addon-santa-hat{% unless addon_variant.available %} disabled{% endunless %}><label for="s2s-addon-santa-hat-{{ section_id }}"><span>{{ 's2s.santa_addon' | t }} <span class="money">{{ addon_variant.price | money }}</span></span><small>{{ 's2s.santa_addon_help' | t }}</small></label><script type="application/json" data-s2s-addon-product="add-a-santa-hat">{{ addon_product.variants | json }}</script></div>{% endif %}
  {% if show_name %}{% assign addon_product = s2s_preview_addons.sleeve_name | default: all_products['s2s-artwork-proof-checkbox'] %}{% assign addon_variant = addon_product.selected_or_first_available_variant %}<div class="s2s-family-addon"><input id="s2s-addon-sleeve-name-{{ section_id }}" type="checkbox" value="{{ addon_variant.id }}" data-price="{{ addon_variant.price }}" data-s2s-addon="s2s-artwork-proof-checkbox" data-s2s-addon-sleeve-name{% unless addon_variant.available %} disabled{% endunless %}><label for="s2s-addon-sleeve-name-{{ section_id }}"><span>{{ 's2s.sleeve_name_addon' | t }} <span class="money">{{ addon_variant.price | money }}</span></span><small>{{ 's2s.sleeve_name_addon_help' | t }}</small></label><script type="application/json" data-s2s-addon-product="s2s-artwork-proof-checkbox">{{ addon_product.variants | json }}</script></div>{% endif %}
</fieldset>`,
  "s2s-product-trust": String.raw`{% doc %}
Renders the delivery, satisfaction, and shipping assurances below a customizable product form.
{% enddoc %}
<ul class="s2s-product-trust" aria-label="{{ 's2s.purchase_assurances' | t }}">
  <li><svg aria-hidden="true" viewBox="0 0 32 32"><path d="M4 20V9h15v11H4Zm15-7h5l4 5v2h-9v-7ZM9 25a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span>{{ 's2s.delivery_window' | t }}</span></li>
  <li><svg aria-hidden="true" viewBox="0 0 32 32"><path d="M16 27S5 21 5 12.5C5 8.8 8 6 11.5 6c2.1 0 3.7 1 4.5 2.5C16.8 7 18.4 6 20.5 6 24 6 27 8.8 27 12.5 27 21 16 27 16 27Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m11.5 15 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>{{ 's2s.satisfaction_short' | t }}</span></li>
  <li><svg aria-hidden="true" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 19c3-1 5-4 6-8 1 4 3 7 6 8M12 22h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>{{ 's2s.shipping_threshold' | t }}</span></li>
</ul>`,
} as const;

function section(config: FamilySectionConfig) {
  const selectOptions = (config.selectOptions || []).join("|");
  const visualOptionNames = (config.visualOptionNames || []).join("|");
  const personalization = config.uploadProperty
    ? `{% render 's2s-product-uploader', product: product, section_id: section.id, family_key: '${config.marker}', property_name: '${config.uploadProperty}', name_property: '${config.nameProperty || ""}', name_required: ${config.nameRequired ? "true" : "false"} %}`
    : "";
  const extras = config.extras?.length
    ? `{% render 's2s-product-addons', section_id: section.id, show_skip: ${config.extras.some((extra) => extra.handle === "skip-the-line") ? "true" : "false"}, show_digital: ${config.extras.some((extra) => extra.handle === "digital-download") ? "true" : "false"}, show_santa: ${config.extras.some((extra) => extra.handle === "add-a-santa-hat") ? "true" : "false"}, show_name: ${config.extras.some((extra) => extra.handle === "s2s-artwork-proof-checkbox") ? "true" : "false"}, s2s_preview_addons: nil %}`
    : "";
  const trust = config.showTrust ? "{% render 's2s-product-trust' %}" : "";
  const optionStepOpen = config.stepOptions
    ? '<div class="s2s-family-option-step" data-family-option-step="{{ forloop.index }}"{% unless forloop.first %} hidden{% endunless %}>'
    : "";
  const optionStepClose = config.stepOptions
    ? `{% unless forloop.last %}<button type="button" class="btn btn-primary s2s-family-option-next" data-family-next-option>{{ 's2s.next' | t }} &#8594;</button>{% endunless %}</div>`
    : "";
  const purchase = config.stepOptions
    ? `<div class="s2s-family-purchase" data-family-step-purchase hidden>${config.hiddenQuantity ? '<input type="hidden" name="quantity" value="1">' : '<label class="visually-hidden" for="s2s-quantity-{{ section.id }}">{{ \'s2s.quantity\' | t }}</label><input id="s2s-quantity-{{ section.id }}" type="number" name="quantity" min="1" value="1" aria-label="{{ \'s2s.quantity\' | t }}">'}<button class="btn btn-primary" type="submit" data-s2s-submit{% unless product.selected_or_first_available_variant.available %} disabled{% endunless %}>{% if product.selected_or_first_available_variant.available %}{{ 's2s.add_to_cart' | t }}{% else %}{{ 's2s.sold_out' | t }}{% endif %}</button></div>`
    : `<div class="s2s-family-purchase"><label class="visually-hidden" for="s2s-quantity-{{ section.id }}">{{ 's2s.quantity' | t }}</label><input id="s2s-quantity-{{ section.id }}" type="number" name="quantity" min="1" value="1" aria-label="{{ 's2s.quantity' | t }}"><button class="btn btn-primary" type="submit" data-s2s-submit{% unless product.selected_or_first_available_variant.available %} disabled{% endunless %}>{% if product.selected_or_first_available_variant.available %}{{ 's2s.add_to_cart' | t }}{% else %}{{ 's2s.sold_out' | t }}{% endif %}</button></div>`;
  const behaviorAttributes = config.marker === "phone-product"
    ? ' data-s2s-option-dependency="brand-prefix"'
    : config.marker === "embroidered-product"
      ? ' data-s2s-option-contract-required'
    : config.marker === "mug-product"
      ? ' data-s2s-name-toggle-option="0"'
      : "";
  const optionVisual = config.marker === "embroidered-product"
    ? `{% if option_is_visual and is_color == false %}<span class="s2s-family-option-visual">{% render 's2s-option-visual', product: product, option_name: option.name, option_value: value %}</span>{% endif %}`
    : config.visualOptions || config.visualOptionNames?.length
    ? "{% if option_is_visual and is_color == false %}{% assign option_image = product.images[forloop.index0] %}<span class=\"s2s-family-option-visual\">{% if option_image %}{{ option_image | image_url: width: 420 | image_tag: loading: 'lazy', widths: '160,240,320,420', sizes: '(min-width: 801px) 10vw, 29vw', alt: value }}{% endif %}</span>{% endif %}"
    : "";
  const description = config.descriptionDisclosure
    ? `<details class="s2s-family-description s2s-family-description-disclosure"><summary>Details</summary>{% if product.description != blank %}<div class="s2s-family-description-body">{{ product.description }}</div>{% endif %}</details>`
    : `{% if product.description != blank %}<div class="s2s-family-description">{{ product.description }}</div>{% endif %}`;
  const descriptionBeforeForm = config.descriptionAfterForm ? "" : description;
  const descriptionAfterForm = config.descriptionAfterForm ? description : "";
  const colorVisual = config.marker === "embroidered-product"
    ? `{% render 's2s-option-visual', product: product, option_name: option.name, option_value: value %}`
    : `<span class="s2s-family-color s2s-family-color--{{ value | handleize }}" aria-hidden="true"></span>`;
  const optionLegend = config.marker === "embroidered-product"
    ? `{{ option_label | remove: ':' | escape }}{% if is_color %}: <span data-option-label>{{ option.selected_value | escape }}</span>{% endif %}`
    : `{{ option_label | escape }}{% unless option_last == ':' %}:{% endunless %} <span data-option-label>{{ option.selected_value | escape }}</span>`;
  const optionLastAssign = config.marker === "embroidered-product"
    ? ""
    : "{% assign option_last = option_label | slice: -1, 1 %}";
  return String.raw`{{ 's2s-family-product.css' | asset_url | stylesheet_tag }}${config.marker === "embroidered-product" ? "{{ 's2s-option-media.css' | asset_url | stylesheet_tag }}" : ""}
{% liquid
  assign s2s_family = 'standard'
  for tag in product.tags
    if tag contains 'site2shop-family-'
      assign s2s_family = tag | remove: 'site2shop-family-'
    endif
  endfor
%}
<section class="container s2s-family-pdp" data-s2s-family-product data-s2s-${config.marker}${behaviorAttributes} data-s2s-scroll-mode="${config.scrollMode}"${config.scrollMode === "bounded-gallery" ? " data-s2s-sticky-gallery" : ""} data-family="{{ s2s_family | escape }}">
  <div class="s2s-family-gallery">
    <div class="s2s-family-stage">
      {% for image in product.images %}
        {% if forloop.first %}{% assign image_loading = 'eager' %}{% assign image_priority = 'high' %}{% else %}{% assign image_loading = 'lazy' %}{% assign image_priority = 'auto' %}{% endif %}
        <figure class="s2s-family-slide" data-family-slide="{{ forloop.index0 }}"{% unless forloop.first %} hidden{% endunless %}>{{ image | image_url: width: 1600 | image_tag: loading: image_loading, fetchpriority: image_priority, widths: '480,720,960,1200,1600', sizes: '(min-width: 1400px) 746px, (min-width: 801px) 52vw, calc(100vw - 2rem)', alt: image.alt | default: product.title }}</figure>
      {% endfor %}
      {% if product.images.size > 1 %}<button type="button" class="s2s-family-arrow s2s-family-arrow--previous" data-family-previous aria-label="Previous image">&#8592;</button><button type="button" class="s2s-family-arrow s2s-family-arrow--next" data-family-next aria-label="Next image">&#8594;</button>{% endif %}
    </div>
    <div class="s2s-family-thumbs-viewport" data-family-thumbs-viewport tabindex="0" aria-label="Product image thumbnails">
      <div class="s2s-family-thumbs" data-family-thumbs-track role="list" aria-label="Product images">
        {% for image in product.images %}<button type="button" class="s2s-family-thumb{% if forloop.first %} is-active{% endif %}" data-family-thumb="{{ forloop.index0 }}"{% if forloop.first %} aria-current="true"{% endif %}>{{ image | image_url: width: 320 | image_tag: loading: 'lazy', widths: '120,180,240,320', sizes: 'var(--s2s-thumb-size, 140px)', alt: image.alt | default: product.title }}</button>{% endfor %}
      </div>
    </div>
  </div>
  <div class="s2s-family-details">
    <h1>{{ product.title | escape }}</h1>
    <div class="s2s-family-rating-blocks" data-s2s-product-rating-slot>{% content_for 'blocks' %}<span class="loox-rating s2s-product-rating s2s-rating-placeholder" data-s2s-product-rating data-s2s-rating-placeholder data-id="{{ product.id }}" aria-hidden="true"></span></div><style>.s2s-rating-placeholder{display:inline-flex;width:120px;height:19px;min-width:120px;min-height:19px}.s2s-family-rating-blocks:has(.loox-rating:not([data-s2s-rating-placeholder])) .s2s-rating-placeholder{display:none}</style>
    <div class="s2s-family-price"><s data-s2s-compare{% unless product.selected_or_first_available_variant.compare_at_price > product.selected_or_first_available_variant.price %} hidden{% endunless %}>{{ product.selected_or_first_available_variant.compare_at_price | money }}</s><strong data-s2s-price>{{ product.selected_or_first_available_variant.price | money }}</strong></div>
    ${descriptionBeforeForm}
    {% form 'product', product, class: 's2s-family-form', enctype: 'multipart/form-data' %}
      ${config.selectOptions?.length ? '<input type="hidden" name="id" data-s2s-variant-id value="{{ product.selected_or_first_available_variant.id }}">' : ""}
      {% unless product.has_only_default_variant %}
        {% assign s2s_select_options = '${selectOptions}' | split: '|' %}
        {% for option in product.options_with_values %}
          ${optionStepOpen}
          {% assign option_label = option.name | strip %}${optionLastAssign}{% assign option_name = option_label | downcase %}{% assign is_color = false %}{% if option_name contains 'color' or option_name contains 'colour' or option_name contains 'background' %}{% assign is_color = true %}{% endif %}{% assign s2s_visual_options = '${visualOptionNames}' | split: '|' %}{% assign option_is_visual = false %}{% if ${config.visualOptions ? "true" : "false"} or s2s_visual_options contains option_name %}{% assign option_is_visual = true %}{% endif %}
          {% assign option_key = option_name | remove: ':' | strip %}
          {% if s2s_select_options contains option_key %}
          <div class="s2s-family-option s2s-family-option--select" data-s2s-option-group="{{ forloop.index0 }}" data-s2s-option-name="{{ option_key | escape }}" data-s2s-control="select" data-s2s-depends-on="0">
            <label for="s2s-select-{{ section.id }}-{{ option.position }}">{{ option_label | remove: ':' | escape }}</label>
            <select class="form-select s2s-family-select" id="s2s-select-{{ section.id }}-{{ option.position }}" name="s2s-family-option-{{ option.position }}" data-s2s-option="{{ forloop.index0 }}">
              {% for value in option.values %}<option value="{{ value | escape }}"{% if value == option.selected_value %} selected{% endif %}{% if value.available == false %} disabled{% endif %}>{{ value | escape }}</option>{% endfor %}
            </select>
          </div>
          {% else %}
          <fieldset class="s2s-family-option{% if is_color %} s2s-family-option--color{% endif %}" data-s2s-option-group="{{ forloop.index0 }}"><legend>${optionLegend}</legend><div class="s2s-family-values">
            {% for value in option.values %}{% assign value_id = 's2s-family-option-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input aria-label="{{ value | escape }}" class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-family-option-{{ option.position }}" value="{{ value | escape }}" data-s2s-option="{{ option.position | minus: 1 }}"{% if value == option.selected_value %} checked{% endif %}><label class="s2s-family-value{% if is_color %} s2s-family-value--color{% endif %}{% if option_is_visual %} s2s-family-value--visual{% endif %}" for="{{ value_id }}">{% if is_color %}${colorVisual}{% endif %}${optionVisual}{% if is_color == false or ${config.marker === "home-product" || config.marker === "quote-product" ? "true" : "false"} %}<span>{{ value | escape }}</span>{% endif %}</label>{% endfor %}
          </div></fieldset>
          {% endif %}
          ${optionStepClose}
        {% endfor %}
      {% endunless %}
      ${personalization}
      ${extras}
      ${purchase}
      <p class="s2s-form-status" role="status" data-s2s-status></p><script type="application/json" data-s2s-variants>{{ product.variants | json }}</script>${config.marker === "embroidered-product" ? "{% render 's2s-option-media-data', product: product %}" : ""}
    {% endform %}
    ${trust}
    ${descriptionAfterForm}
  </div>
</section><script src="{{ 's2s-product-gallery.js' | asset_url }}" defer></script><script src="{{ '${config.marker === "embroidered-product" ? "s2s-family-product-v3.js" : "s2s-family-product.js"}' | asset_url }}" defer></script><script src="{{ 's2s-variant-sync.js' | asset_url }}" defer></script>${config.marker === "embroidered-product" ? '<script src="{{ \'s2s-option-media.js\' | asset_url }}" defer></script>' : ""}${schema(config.name)}`;
}

const skip = { handle: "skip-the-line", marker: "skip-line", label: "Want your order sooner?" };
const digital = { handle: "digital-download", marker: "digital-download", label: "Digital Download" };
const santa = { handle: "add-a-santa-hat", marker: "santa-hat", label: "Add A Santa Hat" };
const sleeveName = { handle: "s2s-artwork-proof-checkbox", marker: "sleeve-name", label: "Add Pet Name on Sleeve?" };

export const customProductSection = section({ name: "Custom product", marker: "custom-product", uploadProperty: "Upload Pet Photo", showTrust: true, scrollMode: "document-flow" });
export const standardProductSection = section({ name: "Standard product", marker: "standard-product", scrollMode: "document-flow", descriptionAfterForm: true, descriptionDisclosure: true });
export const familyProductSections = {
  "s2s-accessory-product": section({ name: "Pet accessory product", marker: "accessory-product", uploadProperty: "Upload Pet Photo", extras: [skip], showTrust: true, scrollMode: "bounded-gallery" }),
  "s2s-apparel-product": section({ name: "Apparel product", marker: "apparel-product", extras: [skip, sleeveName], showTrust: true, scrollMode: "bounded-gallery" }),
  "s2s-custom-apparel-product": section({ name: "Custom apparel product", marker: "custom-apparel-product", uploadProperty: "Upload Pet Photo", extras: [skip, santa], showTrust: true, scrollMode: "bounded-gallery" }),
  "s2s-embroidered-product": section({ name: "Embroidered product", marker: "embroidered-product", uploadProperty: "Upload Pet Photo", extras: [skip], showTrust: true, visualOptionNames: ["embroidery style"], scrollMode: "bounded-gallery" }),
  "s2s-hat-product": section({ name: "Embroidered hat product", marker: "hat-product", extras: [skip, sleeveName], showTrust: true, scrollMode: "bounded-gallery" }),
  "s2s-gift-card-product": section({ name: "Gift card product", marker: "gift-card-product", selectOptions: ["choose amount"], scrollMode: "document-flow", descriptionAfterForm: true, descriptionDisclosure: true }),
  "s2s-home-product": section({ name: "Custom home product", marker: "home-product", selectOptions: ["name on blanket?"], uploadProperty: "Upload Pet Photo", nameProperty: "Pet Name (optional)", extras: [skip, digital], showTrust: true, scrollMode: "document-flow" }),
  "s2s-jewelry-product": section({ name: "Jewelry product", marker: "jewelry-product", uploadProperty: "Upload Pet Photo 1", nameProperty: "Pet Name 1", nameRequired: true, extras: [skip], showTrust: true, scrollMode: "bounded-gallery" }),
  "s2s-mug-product": section({ name: "Portrait mug product", marker: "mug-product", uploadProperty: "Upload Pet Photo 1", nameProperty: "Pet Name (optional)", extras: [skip, digital, santa], showTrust: true, scrollMode: "document-flow" }),
  "s2s-phone-product": section({ name: "Phone case product", marker: "phone-product", selectOptions: ["phone model"], uploadProperty: "Upload Pet Photo", extras: [skip, digital, santa], showTrust: true, scrollMode: "document-flow" }),
  "s2s-quote-product": section({ name: "Quote sign product", marker: "quote-product", stepOptions: true, hiddenQuantity: true, visualOptions: true, scrollMode: "document-flow", descriptionAfterForm: true }),
} as const;

export const familyVariantSyncScript = String.raw`(()=>{const init=root=>{if(root.dataset.s2sVariantSync)return;root.dataset.s2sVariantSync='true';const form=root.querySelector('form'),groups=form?[...form.querySelectorAll('[data-s2s-option-group]')]:[];if(!form)return;let variants=[];try{variants=JSON.parse(form.querySelector('[data-s2s-variants]')?.textContent||'[]')}catch{}const variantOptions=item=>Array.isArray(item.options)?item.options:[item.option1,item.option2,item.option3].filter(value=>value!=null);const optionValues=()=>groups.map(group=>String(group.querySelector('input[type="radio"]:checked:not([name="form-option-framing-swicher"])')?.value||group.querySelector('select')?.value||'').trim());const modelMatchesBrand=(model,brand)=>brand==='samsung'?/^(?:samsung\s+)?galaxy\b/.test(model):model.startsWith(brand);const syncSelectAvailability=()=>{const values=optionValues();groups.forEach((group,index)=>{const select=group.querySelector('select');if(!select)return;const brandPrefix=root.dataset.s2sOptionDependency==='brand-prefix'&&index===1?String(values[0]||'').trim().toLowerCase():'';[...select.options].forEach(option=>{const possible=brandPrefix?modelMatchesBrand(String(option.value).trim().toLowerCase(),brandPrefix)&&variants.some(item=>{const options=variantOptions(item);return item.available!==false&&String(options[0]||'').trim()===values[0]&&String(options[index]||'').trim()===String(option.value).trim()}):variants.some(item=>{const options=variantOptions(item);return item.available!==false&&String(options[index]||'').trim()===String(option.value).trim()&&values.slice(0,index).every((value,prior)=>String(options[prior]||'').trim()===value)});option.disabled=!possible});if(select.selectedOptions[0]?.disabled){const fallback=[...select.options].find(option=>!option.disabled);if(fallback)select.value=fallback.value}})};const selected=()=>{const values=optionValues(),variant=groups.length?variants.find(item=>{const options=variantOptions(item);return options.length===values.length&&options.every((value,index)=>String(value).trim()===values[index])}):variants[0];root.dataset.s2sSelectedOptions=JSON.stringify(values);root.dataset.s2sSelectedVariant=variant?String(variant.id):'';return variant};const sync=()=>{syncSelectAvailability();const input=form.querySelector('[data-s2s-variant-id]'),variant=selected();root.dataset.s2sVariantInput=input?'found':'missing';if(!input)return;try{if(variant)input.setAttribute('value',String(variant.id));else input.removeAttribute('value');root.dataset.s2sVariantValue=input.getAttribute('value')||''}catch(error){root.dataset.s2sVariantError=String(error?.message||error)}};form.addEventListener('change',sync,true);form.addEventListener('submit',sync,true);form.querySelectorAll('button[type="submit"]').forEach(button=>{button.addEventListener('pointerdown',sync,true);button.addEventListener('click',sync,true)});new MutationObserver(sync).observe(form,{childList:true,subtree:true});[0,50,250,1000,2500].forEach(delay=>setTimeout(sync,delay));addEventListener('load',sync,{once:true});addEventListener('pageshow',sync)};document.querySelectorAll('[data-s2s-family-product],[data-s2s-portrait-product]').forEach(init)})();`;

export const familyProductScript = String.raw`(()=>{
  const MAX=10485760;
  let commerce={};
  try{commerce=JSON.parse(document.querySelector('#s2s-commerce-config')?.textContent||'{}')}catch{}
  const t=(key,fallback)=>commerce.text?.[key]||fallback;
  const cartRoot=commerce.root||window.Shopify?.routes?.root||'/';
  const request=async(path,options={})=>{const response=await fetch(cartRoot+path,{credentials:'same-origin',...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.description||data.message||t('failed','Could not add this product. Please try again.'));return data};
  const post=(path,data)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  document.querySelectorAll('[data-s2s-family-product]').forEach(root=>{
    root.querySelectorAll('[data-family-next-option]').forEach(button=>button.addEventListener('click',()=>{const current=button.closest('[data-family-option-step]'),next=current?.nextElementSibling;if(!current||!next?.matches?.('[data-family-option-step]'))return;current.hidden=true;next.hidden=false;if(!next.querySelector('[data-family-next-option]')){const purchase=root.querySelector('[data-family-step-purchase]');if(purchase)purchase.hidden=false}}));
    const behaviorForm=root.querySelector('form');const syncNameToggle=()=>{const optionIndex=Number(root.dataset.s2sNameToggleOption);if(!Number.isInteger(optionIndex))return;const selected=behaviorForm?.querySelector('[data-s2s-option="'+optionIndex+'"]:checked')?.value||behaviorForm?.querySelector('select[data-s2s-option="'+optionIndex+'"]')?.value||'';const input=behaviorForm?.querySelector('.s2s-personalization input[type="text"]');const label=input?.id?behaviorForm.querySelector('label[for="'+CSS.escape(input.id)+'"]'):null;const hidden=/^no\s*name$/i.test(String(selected).trim());if(input){input.hidden=hidden;if(label)label.hidden=hidden}};behaviorForm?.addEventListener('change',syncNameToggle);syncNameToggle();
    if(root.dataset.ready)return;
    root.dataset.ready='true';
    let busy=false,previewUrl='';
    const form=root.querySelector('.s2s-family-form');
    if(!form)return;
    let variants=[];
    try{variants=JSON.parse(form.querySelector('[data-s2s-variants]')?.textContent||'[]')}catch{}
    const groups=[...form.querySelectorAll('[data-s2s-option-group]')],button=form.querySelector('[data-s2s-submit]'),status=form.querySelector('[data-s2s-status]'),price=root.querySelector('[data-s2s-price]'),compare=root.querySelector('[data-s2s-compare]'),file=form.querySelector('[data-s2s-photo]'),preview=form.querySelector('[data-s2s-photo-preview]'),image=form.querySelector('.s2s-photo-image'),fileName=form.querySelector('[data-s2s-photo-name]'),dropzone=form.querySelector('[data-s2s-dropzone]'),extraInputs=[...form.querySelectorAll('[data-s2s-addon]')];
    const money=cents=>new Intl.NumberFormat(document.documentElement.lang||'en-US',{style:'currency',currency:window.Shopify?.currency?.active||'USD'}).format(Number(cents||0)/100);
    const optionValues=()=>groups.map(group=>String(group.querySelector('input[type="radio"]:checked:not([name="form-option-framing-swicher"])')?.value||group.querySelector('select')?.value||'').trim());
    const modelMatchesBrand=(model,brand)=>brand==='samsung'?/^(?:samsung\s+)?galaxy\b/.test(model):model.startsWith(brand);
    const syncDependentOptions=()=>groups.forEach((group,index)=>{
      const select=group.querySelector('select'),parent=Number(group.dataset.s2sDependsOn);
      if(!select||!group.hasAttribute('data-s2s-depends-on')||!Number.isInteger(parent)||parent<0||parent>=index)return;
      const values=optionValues();
      const brandPrefix=root.dataset.s2sOptionDependency==='brand-prefix'&&index===1?String(values[parent]||'').trim().toLowerCase():'';
      for(const option of select.options)option.disabled=brandPrefix
        ?!(modelMatchesBrand(String(option.value).trim().toLowerCase(),brandPrefix)&&variants.some(variant=>{const options=variant.options||[variant.option1,variant.option2,variant.option3];return variant.available&&String(options[parent])===values[parent]&&String(options[index])===option.value}))
        :!variants.some(variant=>{
          const options=variant.options||[variant.option1,variant.option2,variant.option3];
          return variant.available&&String(options[parent])===values[parent]&&String(options[index])===option.value;
        });
      const enabled=[...select.options].filter(option=>!option.disabled);
      select.disabled=enabled.length===0;
      if(!enabled.some(option=>option.value===select.value)){
        if(brandPrefix)select.value=enabled[0]?.value||'';
        else{
          const fallback=variants.find(variant=>{const options=variant.options||[variant.option1,variant.option2,variant.option3];return variant.available&&String(options[parent])===values[parent]&&enabled.some(option=>option.value===String(options[index]))});
          select.value=fallback?String((fallback.options||[fallback.option1,fallback.option2,fallback.option3])[index]):'';
        }
      }
    });
    const selected=()=>{const values=optionValues(),variant=groups.length?variants.find(item=>{const options=Array.isArray(item.options)?item.options:[item.option1,item.option2,item.option3].filter(value=>value!=null);return options.length===values.length&&options.every((value,i)=>String(value).trim()===values[i])}):variants[0];root.dataset.s2sSelectedOptions=JSON.stringify(values);root.dataset.s2sSelectedVariant=variant?String(variant.id):'';return variant};
    const say=message=>{if(status)status.textContent=message||''};
    const validPhoto=()=>{if(!file)return true;const chosen=file.files?.[0],required=file.required||file.hasAttribute('data-s2s-required-photo');if(!chosen)return !required;return /^(image\/jpeg|image\/png|image\/webp)$/.test(chosen.type)&&chosen.size>0&&chosen.size<=MAX};
    extraInputs.forEach(input=>{let addon=[];try{addon=JSON.parse(form.querySelector('[data-s2s-addon-product="'+input.dataset.s2sAddon+'"]')?.textContent||'[]')}catch{}const variant=addon.find(item=>item.available)||addon[0];input.disabled=!variant?.available;input.value=variant?.id||'';input.dataset.price=variant?.price||'0';const label=form.querySelector('label[for="'+input.id+'"]');const amount=label?.querySelector('.money');if(amount&&variant)amount.textContent=money(variant.price)});
    const update=event=>{
      syncDependentOptions();
      const values=optionValues();
      groups.forEach((group,i)=>{const label=group.querySelector('[data-option-label]');if(label)label.textContent=values[i]||''});
      const variant=selected(),variantInput=form.querySelector('[data-s2s-variant-id],input[name="id"]');
      if(variantInput)variantInput.value=variant?String(variant.id):'';
      if(price)price.textContent=variant?money(variant.price):t('unavailable','Unavailable');
      if(compare){const visible=variant?.compare_at_price>variant?.price;compare.hidden=!visible;if(visible)compare.textContent=money(variant.compare_at_price)}
      if(button){button.disabled=busy||!variant?.available;button.textContent=variant?.available?t('add_to_cart','Add to cart'):t('sold_out','Sold out')}
      const unavailable=t('unavailable','This option combination is unavailable.');
      if(status&&!variant)say(unavailable);else if(status&&!busy&&status.textContent===unavailable)say('');
      if(event?.target?.dataset.s2sOption==='0'&&!root.hasAttribute('data-s2s-phone-product')&&!root.hasAttribute('data-s2s-option-contract-required')){
        const position=[...groups[0].querySelectorAll('input')].findIndex(input=>input.checked);
        if(position>=0)root.dispatchEvent(new CustomEvent('s2s:media:show',{detail:{index:position}}));
      }
    };
    form.addEventListener('change',update);
    update();
    const previewFile=()=>{const chosen=file?.files?.[0];if(previewUrl)URL.revokeObjectURL(previewUrl);if(!chosen){if(preview)preview.hidden=true;dropzone?.classList.remove('has-file');return}if(!validPhoto()){file.value='';say(t('invalid_photo','Choose a JPG, PNG or WebP photo up to 10 MB.'));if(preview)preview.hidden=true;dropzone?.classList.remove('has-file');return}say('');previewUrl=URL.createObjectURL(chosen);if(image)image.src=previewUrl;if(fileName)fileName.textContent=chosen.name;if(preview)preview.hidden=false;dropzone?.classList.add('has-file')};
    file?.addEventListener('change',previewFile);
    if(dropzone&&file){['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.add('is-dragging')}));['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.remove('is-dragging')}));dropzone.addEventListener('drop',event=>{const dropped=event.dataTransfer?.files;if(!dropped?.length)return;const transfer=new DataTransfer();transfer.items.add(dropped[0]);file.files=transfer.files;file.dispatchEvent(new Event('change',{bubbles:true}))})}
    const rollback=async group=>{const cart=await request('cart.js');const updates=Object.fromEntries(cart.items.filter(item=>item.properties?._s2s_group===group).map(item=>[item.key,0]));if(Object.keys(updates).length)await post('cart/update.js',{updates})};
    form.addEventListener('submit',async event=>{
      const variant=selected();
      if(!variant?.available||!validPhoto()||!form.checkValidity()){event.preventDefault();if(!validPhoto())say(t('invalid_photo','Choose a JPG, PNG or WebP photo up to 10 MB.'));else if(!variant?.available)say(t('unavailable','Choose an available option.'));form.reportValidity();return}
      const picked=extraInputs.filter(input=>input.checked&&!input.disabled&&input.value);
      event.preventDefault();
      if(busy)return;
      busy=true;
      form.setAttribute('aria-busy','true');
      update();
      say(t('processing','Adding your product…'));
      const group=crypto.randomUUID();
      try{
        const existing=await request('cart.js');
        if(existing.items.some(item=>item.properties?._s2s_group===group))throw new Error(t('uncertain','Please check your cart before trying again.'));
        const data=new FormData(form);
        data.set('id',variant.id);
        data.set('quantity',String(Math.max(1,Number(data.get('quantity')||1))));
        data.set('properties[_s2s_group]',group);
        data.set('properties[_s2s_role]','portrait');
        const added=await request('cart/add.js',{method:'POST',body:data});
        const shared={};
        Object.entries(added.properties||{}).forEach(([key,value])=>{if(key.charAt(0)!=='_'&&value)shared[key]=value});
        const quantity=Math.max(1,Number(data.get('quantity')||1));
        const items=picked.map(input=>({id:Number(input.value),quantity,properties:{...shared,_s2s_group:group,_s2s_role:'addon'}}));
        if(items.length)await post('cart/add.js',{items});
        const cart=await request('cart.js');
        const attempt=cart.items.filter(item=>item.properties?._s2s_group===group);
        if(attempt.length!==items.length+1)throw new Error(t('uncertain','Please check your cart before trying again.'));
        location.assign(cartRoot+'cart');
      }catch(error){try{await rollback(group);say(error.message||t('failed','Could not add this product. Please try again.'))}catch{say(t('uncertain','Please check your cart before trying again.'))}busy=false;form.removeAttribute('aria-busy');update()}
    },true)
  })
})();`;

const familyProductBaseStyles = String.raw`.s2s-family-pdp{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(25rem,.8fr);gap:clamp(2rem,3vw,3rem);padding-block:clamp(2rem,4vw,4rem)}.s2s-family-stage{position:relative;border-radius:1rem;background:#f7f7f7;overflow:hidden}.s2s-family-slide{margin:0}.s2s-family-slide img{display:block;width:100%;height:auto}.s2s-family-arrow{position:absolute;top:50%;translate:0 -50%;width:2.25rem;height:2.25rem;border:0;border-radius:50%;background:#cfa184;color:#fff;cursor:pointer}.s2s-family-arrow--previous{left:1rem}.s2s-family-arrow--next{right:1rem}.s2s-family-thumbs-viewport{width:100%;max-width:100%;margin-top:.85rem;overflow:hidden}.s2s-family-thumbs-viewport:focus-visible{outline:2px solid #1a2829;outline-offset:2px}.s2s-family-thumbs{display:flex;gap:.75rem;width:max-content;max-width:none;transition:transform .2s ease;will-change:transform}.s2s-family-thumb{flex:0 0 var(--s2s-thumb-size,140px);width:var(--s2s-thumb-size,140px);aspect-ratio:1/1;padding:.2rem;border:1px solid transparent;border-radius:.75rem;background:#f7f7f7;overflow:hidden;cursor:pointer}.s2s-family-thumb.is-active{border-color:#1a2829}.s2s-family-thumb img{display:block;width:100%;height:100%;object-fit:contain}.s2s-family-details{position:static;align-self:start}.s2s-family-details h1{margin:0 0 .65rem;font-size:clamp(2rem,3vw,2.75rem);line-height:1.08}.s2s-family-details .s2s-rating-link{display:inline-flex;margin-bottom:1rem}.s2s-family-price{display:flex;gap:.65rem;align-items:baseline;margin-bottom:1.25rem;font-size:1.45rem}.s2s-family-price s{font-size:1.15rem;opacity:.6}.s2s-family-description{margin-bottom:1.5rem}.s2s-family-description img{max-width:100%;height:auto}.s2s-family-option{margin:0 0 1.35rem;padding:0;border:0}.s2s-family-option legend{margin-bottom:.65rem;font-size:1rem}.s2s-family-values{display:flex;flex-wrap:wrap;gap:.55rem}.s2s-family-value{display:inline-flex;align-items:center;justify-content:center;min-height:2.35rem;padding:.45rem .85rem;border:1px solid #1a2829;border-radius:2rem;cursor:pointer}.s2s-family-values input:checked+.s2s-family-value{background:#1a2829;color:#fff}.s2s-family-value--color{display:grid;gap:.25rem;min-width:3.25rem;padding:.2rem .25rem;border:0;border-radius:.6rem;font-size:.78rem}.s2s-family-values input:checked+.s2s-family-value--color{background:transparent;color:inherit}.s2s-family-color{display:block;width:2.35rem;height:2.35rem;margin:auto;border:1px solid #ddd;border-radius:50%;background:#ddd;box-shadow:0 1px 3px #0003}.s2s-family-values input:checked+.s2s-family-value--color .s2s-family-color{outline:2px solid #1a2829;outline-offset:2px}.s2s-family-color--soft-white,.s2s-family-color--white{background:#fafafa}.s2s-family-color--dusty-pink,.s2s-family-color--light-pink,.s2s-family-color--pink{background:#e8cbd4}.s2s-family-color--charcoal-gray,.s2s-family-color--black{background:#242424}.s2s-family-color--sage,.s2s-family-color--olive{background:#aeb09d}.s2s-family-color--navy,.s2s-family-color--ocean,.s2s-family-color--light-blue{background:#385979}.s2s-family-color--terracotta,.s2s-family-color--holiday-red{background:#bd7058}.s2s-family-color--sand,.s2s-family-color--gold{background:#dfc99e}.s2s-family-color--silver,.s2s-family-color--light-gray,.s2s-family-color--light-grey{background:#cfcfcf}.s2s-family-color--winter-green{background:#426353}.s2s-family-color--shiplap{background:repeating-linear-gradient(90deg,#fff 0 10px,#eee 10px 12px)}.s2s-family-color--buffalo-plaid{background-color:#7d080e;background-image:linear-gradient(90deg,transparent 50%,#0004 50%),linear-gradient(transparent 50%,#0005 50%);background-size:16px 16px}.s2s-personalization{margin:1.5rem 0;padding:0;border-radius:0;background:transparent}.s2s-personalization input{display:block;width:100%;margin:.4rem 0 1rem;padding:.75rem;border:1px solid #1a2829;border-radius:.35rem}.s2s-photo-preview{display:flex;align-items:center;gap:.75rem}.s2s-photo-preview img{width:64px;height:64px;object-fit:cover;border-radius:.5rem}.s2s-family-addons{margin:1.5rem 0;padding:0;border:0}.s2s-family-addons legend{margin-bottom:.65rem}.s2s-family-addon{display:flex;align-items:flex-start;gap:.6rem;margin:.7rem 0}.s2s-family-addon input{width:1.1rem;height:1.1rem;margin-top:.15rem}.s2s-family-addon label{cursor:pointer}.s2s-family-addon .money{color:#c88f6f;font-weight:700}.s2s-family-purchase{display:flex;gap:.5rem;align-items:center;width:100%;max-width:100%}.s2s-family-purchase label.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.s2s-family-purchase input{box-sizing:border-box;flex:0 0 7.5rem;width:7.5rem;height:42px;min-height:42px;padding:.5rem .75rem;border:1px solid #d9bba9;border-radius:2rem}.s2s-family-purchase button{box-sizing:border-box;flex:1 1 auto;min-width:0;height:42px;min-height:42px;padding:.5rem .75rem;border-radius:2rem}.s2s-form-status{min-height:1.5em;color:#8b322c}@media(max-width:800px){.s2s-family-pdp{grid-template-columns:minmax(0,1fr);gap:1.4rem;width:100%;max-width:100%;padding:1rem}.s2s-family-details{position:static}.s2s-family-details h1{font-size:1.85rem}.s2s-family-purchase input{flex-basis:6.5rem;width:6.5rem}}`;

const familyProductDisclosureStyles = String.raw`.s2s-family-description-disclosure{border-radius:.25rem;background:#f4eeea}.s2s-family-description-disclosure summary{display:flex;min-height:52px;align-items:center;justify-content:space-between;padding:.85rem 1.25rem;cursor:pointer;list-style:none}.s2s-family-description-disclosure summary::-webkit-details-marker{display:none}.s2s-family-description-disclosure summary::after{content:'⌃';font-size:1.2rem;transform:rotate(180deg)}.s2s-family-description-disclosure[open] summary::after{transform:none}.s2s-family-description-body{padding:0 1.25rem 1.25rem}`;

const familyProductScrollStyles = productScrollStyles("family");

const familyProductMeasuredLayoutStyles = String.raw`
@media(min-width:992px){.s2s-family-pdp{grid-template-columns:minmax(0,1fr) 12px 526px 12px;gap:0;padding-inline:0}.s2s-family-gallery{grid-column:1}.s2s-family-details{grid-column:3;width:auto;margin:0;padding:12px 20px 0}}
@media(min-width:401px) and (max-width:800px){.s2s-family-pdp{width:calc(100% - 48px);grid-template-columns:12px minmax(0,1fr) 12px;gap:0;padding-inline:0}.s2s-family-gallery,.s2s-family-details{grid-column:2;width:auto;margin:0}.s2s-family-details{padding-top:32px}}
@media(max-width:400px){.s2s-family-pdp{grid-template-columns:12px minmax(0,1fr) 12px;gap:0;padding-inline:0}.s2s-family-gallery,.s2s-family-details{grid-column:2;width:auto;margin:0}.s2s-family-details{padding-top:32px}}
`;

export const familyProductStyles = familyProductBaseStyles + familyProductDisclosureStyles + String.raw`
.s2s-family-option--select>label{display:block;margin-bottom:.5rem;font-size:14px;line-height:21px}
.s2s-family-select{box-sizing:border-box;display:block;width:100%;max-width:100%;height:38px;min-height:38px;margin:0;padding:6px 36px 6px 12px;border:1px solid #f0e4dd;border-radius:0;background-color:#fff;font-size:16px;line-height:24px;color:inherit}
.s2s-family-select:focus-visible{outline:2px solid #1a2829;outline-offset:2px}
.s2s-family-value--color{position:relative;display:block;width:32px;min-width:32px;height:32px;min-height:32px;margin:0;padding:0;border:0;border-radius:0;overflow:visible}.s2s-family-color{width:32px;height:32px;margin:0 auto}
[data-s2s-accessory-product] .s2s-family-value--color,[data-s2s-custom-apparel-product] .s2s-family-value--color{width:35.2px;min-width:35.2px;height:42.2px;min-height:42.2px;margin-bottom:0}
[data-s2s-embroidered-product] .s2s-family-value--color:has(.s2s-family-color--holiday-red),[data-s2s-embroidered-product] .s2s-family-value--color:has(.s2s-family-color--winter-green){width:35.2px;min-width:35.2px;height:42.2px;min-height:42.2px}
[data-s2s-home-product] .s2s-family-option--color .s2s-family-values,[data-s2s-quote-product] .s2s-family-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem}[data-s2s-home-product] .s2s-family-option--color .s2s-family-values{width:75%}
[data-s2s-home-product] .s2s-family-value--color{width:100%;min-width:0;height:auto;min-height:0;margin:0;padding:0}.s2s-family-value--visual{display:grid;width:100%;min-width:0;height:auto;min-height:0;padding:0;border:0;border-radius:.75rem;overflow:visible}.s2s-family-option-visual,[data-s2s-home-product] .s2s-family-color{display:block;width:100%;height:auto;aspect-ratio:1/1;border:1px solid #ddd;border-radius:.75rem;overflow:hidden}.s2s-family-option-visual img{display:block;width:100%;height:100%;object-fit:contain}
[data-s2s-quote-product] .s2s-family-option-step:nth-of-type(-n+2) .s2s-family-values{width:100%;max-width:624px}[data-s2s-quote-product] .s2s-family-option-step:nth-of-type(3) .s2s-family-values{width:100%;max-width:502px}[data-s2s-quote-product] .s2s-family-value--color{width:100%;min-width:0;height:auto;min-height:0;margin:0;padding:0;align-items:stretch;justify-items:stretch;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 25px}[data-s2s-quote-product] .s2s-family-color,[data-s2s-quote-product] .s2s-family-option-visual{display:block;width:100%;min-width:100%;height:auto;aspect-ratio:1.29/1;border-radius:.75rem}[data-s2s-home-product] .s2s-family-value--color>span:last-child,[data-s2s-quote-product] .s2s-family-value--color>span:last-child{position:static;translate:none;display:block;width:auto;max-width:none;margin:0;text-align:center;line-height:25px}[data-s2s-embroidered-product] .s2s-family-value--visual{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 25px;width:100%;min-width:0;height:auto;min-height:0;padding:0;border:0;border-radius:.75rem;overflow:visible;align-items:stretch}[data-s2s-embroidered-product] .s2s-family-option:has(.s2s-family-value--visual) .s2s-family-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem;width:60%}[data-s2s-embroidered-product] .s2s-family-option-visual{width:100%;min-width:100%;aspect-ratio:1/1}[data-s2s-embroidered-product] .s2s-family-value--visual>span:last-child{display:block;margin:0;text-align:center;line-height:25px}@media(min-width:481px) and (max-width:800px){[data-s2s-embroidered-product] .s2s-family-option:has(.s2s-family-value--visual) .s2s-family-values{width:53%}}@media(max-width:480px){[data-s2s-embroidered-product] .s2s-family-option:has(.s2s-family-value--visual) .s2s-family-values{width:75%}}
.s2s-family-pdp>*{min-width:0}.s2s-family-gallery,.s2s-family-details,.s2s-family-stage,.s2s-family-thumbs-viewport{max-width:100%}.s2s-upload-heading{display:block;margin-bottom:.55rem}.s2s-upload-surface{display:flex;min-height:4.75rem;align-items:center;justify-content:center;gap:.6rem;padding:1rem;border-radius:.35rem;background:#f2f0ef;color:#4d4d4d;cursor:pointer;text-align:center;transition:background-color .18s ease,box-shadow .18s ease}.s2s-upload-surface:hover,.s2s-upload-surface.is-dragging{background:#eee7e2;box-shadow:0 5px 16px #1a28291a}.s2s-upload-surface:focus-within{outline:2px solid #1a2829;outline-offset:2px}.s2s-upload-browse{text-decoration:underline;text-underline-offset:.16em}.s2s-personalization input.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.s2s-upload-hint{margin:.55rem 0 0;font-size:.82rem;color:#666}.s2s-photo-preview{margin-top:.75rem;padding:.55rem;border-radius:.5rem;background:#f7f1ed}.s2s-family-instructions{display:grid;gap:.7rem;margin:1.15rem 0 0;padding:0;list-style:none}.s2s-family-instructions li{display:grid;grid-template-columns:1.25rem minmax(0,1fr);gap:.45rem;align-items:start;line-height:1.45}.s2s-family-instructions svg{margin-top:.1rem}.s2s-family-instructions a{color:inherit;text-underline-offset:.16em}.s2s-family-addon label{display:grid;gap:.12rem}.s2s-family-addon label>span{display:block}.s2s-family-addon small{display:block;color:#777;line-height:1.35}.s2s-product-trust{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:1.65rem 0 0;padding:0;list-style:none;text-align:center}.s2s-product-trust li{display:flex;min-width:0;flex-direction:column;align-items:center;gap:.4rem;font-size:.8rem;line-height:1.25}.s2s-product-trust svg{width:2.2rem;height:2.2rem}.s2s-family-form[aria-busy=true] [data-s2s-submit]{cursor:wait;opacity:.65}@media(max-width:800px){.s2s-family-gallery,.s2s-family-details{width:100%;min-width:0;max-width:100%}.s2s-family-stage{overflow:hidden}.s2s-product-trust{gap:.55rem}.s2s-product-trust li{font-size:.72rem}}` + familyProductScrollStyles + familyProductMeasuredLayoutStyles;
