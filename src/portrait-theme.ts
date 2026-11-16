import { productScrollStyles } from "./product-scroll-theme.js";

export type PortraitWorkflowContracts = {
  schemaVersion: 1;
  products: Record<string, {
    petCount: number;
    variantMedia?: Record<string, number>;
    frameSwatches?: Record<string, number | string>;
  }>;
  addOns?: Array<{
    handle: string;
    label: string;
    help: string;
    placement: "personalization" | "extras";
  }>;
};

const portraitSectionTemplate = String.raw`{{ 's2s-portrait-product.css' | asset_url | stylesheet_tag }}
{% liquid
  assign first_option = product.options_with_values | first
  assign is_artwork = false
  assign s2s_pet_count = 1
  assign s2s_frame_black_image_position = 0
  assign s2s_frame_white_image_position = 0
  assign s2s_frame_walnut_image_position = 0
  assign s2s_frame_birch_image_position = 0
  assign s2s_frame_black_asset = blank
  assign s2s_frame_white_asset = blank
  assign s2s_frame_walnut_asset = blank
  assign s2s_frame_birch_asset = blank
__S2S_PET_COUNT_CASES__
__S2S_FRAME_SWATCH_CASES__
  if first_option.name == 'Artwork Style'
    assign is_artwork = true
  endif
%}
<section class="container s2s-portrait-pdp{% if is_artwork %} s2s-portrait-pdp--artwork{% endif %}" data-s2s-portrait-product data-s2s-scroll-mode="document-flow" {% render 's2s-portrait-frame-style', product: product, black_position: s2s_frame_black_image_position, white_position: s2s_frame_white_image_position, walnut_position: s2s_frame_walnut_image_position, birch_position: s2s_frame_birch_image_position, black_asset: s2s_frame_black_asset, white_asset: s2s_frame_white_asset, walnut_asset: s2s_frame_walnut_asset, birch_asset: s2s_frame_birch_asset %}>
  <div class="s2s-portrait-gallery">
    <div class="s2s-portrait-stage">
      {% for image in product.images %}
        {% if forloop.first %}{% assign image_loading = 'eager' %}{% assign image_priority = 'high' %}{% else %}{% assign image_loading = 'lazy' %}{% assign image_priority = 'auto' %}{% endif %}
        <figure class="s2s-portrait-slide" data-portrait-slide="{{ forloop.index0 }}"{% unless forloop.first %} hidden{% endunless %}>
          {{ image | image_url: width: 1600 | image_tag: loading: image_loading, fetchpriority: image_priority, widths: '480,720,960,1200,1600', sizes: '(min-width: 1400px) 746px, (min-width: 801px) 52vw, calc(100vw - 2rem)', alt: image.alt | default: product.title }}
        </figure>
      {% endfor %}
      {% if product.images.size > 1 %}
        <button type="button" class="s2s-portrait-arrow s2s-portrait-arrow--previous" data-portrait-previous aria-label="{{ 's2s.previous_image' | t }}">&#8592;</button>
        <button type="button" class="s2s-portrait-arrow s2s-portrait-arrow--next" data-portrait-next aria-label="{{ 's2s.next_image' | t }}">&#8594;</button>
      {% endif %}
    </div>
    <div class="s2s-portrait-thumbs-viewport" data-portrait-thumbs-viewport tabindex="0" aria-label="{{ 's2s.product_images' | t }}">
      <div class="s2s-portrait-thumbs" data-portrait-thumbs-track role="list">
        {% for image in product.images %}
          <button type="button" class="s2s-portrait-thumb{% if forloop.first %} is-active{% endif %}" data-portrait-thumb="{{ forloop.index0 }}"{% if forloop.first %} aria-current="true"{% endif %}>
            {{ image | image_url: width: 320 | image_tag: loading: 'lazy', widths: '120,180,240,320', sizes: 'var(--s2s-thumb-size, 140px)', alt: image.alt | default: product.title }}
          </button>
        {% endfor %}
      </div>
    </div>
  </div>
  <div class="s2s-portrait-details">
    <h1>{{ product.title | escape }}</h1>
    <div class="s2s-portrait-rating-blocks" data-s2s-product-rating-slot>{% content_for 'blocks' %}<span class="loox-rating s2s-product-rating s2s-rating-placeholder" data-s2s-product-rating data-s2s-rating-placeholder data-id="{{ product.id }}" aria-hidden="true"></span></div><style>.s2s-rating-placeholder{display:inline-flex;width:120px;height:19px;min-width:120px;min-height:19px}.s2s-portrait-rating-blocks:has(.loox-rating:not([data-s2s-rating-placeholder])) .s2s-rating-placeholder{display:none}</style>
    <div class="s2s-portrait-price"><s data-s2s-compare{% unless product.selected_or_first_available_variant.compare_at_price > product.selected_or_first_available_variant.price %} hidden{% endunless %}>{{ product.selected_or_first_available_variant.compare_at_price | money }}</s><strong data-s2s-price>{{ product.selected_or_first_available_variant.price | money }}</strong></div>
    {% form 'product', product, class: 's2s-portrait-form', enctype: 'multipart/form-data' %}
      <input type="hidden" name="id" value="{{ product.selected_or_first_available_variant.id }}" data-s2s-variant-id>
      <div class="s2s-portrait-step" data-portrait-step="1">
        {% for option in product.options_with_values %}{% if forloop.first %}
          <fieldset class="s2s-portrait-option s2s-portrait-option--primary" data-s2s-option-group="{{ forloop.index0 }}">
            <legend>{{ option.name | escape }}: <span data-option-label>{{ option.selected_value | escape }}</span></legend>
            <div class="s2s-portrait-values">{% for value in option.values %}{% assign value_handle = value | handleize %}{% assign value_id = 's2s-option-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-option-{{ option.position }}" value="{{ value | escape }}" data-s2s-option="{{ option.position | minus: 1 }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}" class="s2s-portrait-value"><span class="s2s-portrait-swatch s2s-portrait-swatch--{{ value_handle }}">{% if is_artwork %}{% assign option_image = product.images | slice: forloop.index0, 1 | first %}{% if option_image %}{{ option_image | image_url: width: 360 | image_tag: loading: 'lazy', widths: '120,180,240,360', sizes: '(min-width: 801px) 10vw, 29vw', alt: value }}{% endif %}{% endif %}{% if value_handle == 'sage' or value_handle == 'shiplap' or value_handle == 'buffalo-plaid' %}<b class="s2s-portrait-option-surcharge">+$11</b>{% endif %}</span><span>{{ value | escape }}</span>{% if value_handle == 'sage' or value_handle == 'shiplap' or value_handle == 'buffalo-plaid' %}<small class="s2s-portrait-limited">Limited Edition</small>{% endif %}</label>{% endfor %}</div>
          </fieldset>
        {% endif %}{% endfor %}
        <div class="s2s-portrait-step-nav"><div class="s2s-portrait-summary"><span>{{ 's2s.subtotal' | t }}:</span> <strong data-s2s-subtotal>{{ product.selected_or_first_available_variant.price | money }}</strong><small>{{ 's2s.free_shipping' | t }}</small></div><button type="button" class="btn btn-primary" data-portrait-next>{{ 's2s.next' | t }} &#8594;</button></div>
        <div class="s2s-portrait-guarantee">✿ {{ 's2s.satisfaction_guarantee' | t }}</div>
      </div>
      <div class="s2s-portrait-step" data-portrait-step="2" hidden>
        {% for option in product.options_with_values %}{% unless forloop.first %}
          {% assign s2s_option_name = option.name | downcase %}
          {% if s2s_option_name contains 'frame' %}
            <fieldset class="s2s-portrait-option s2s-portrait-framing-mode"><legend>Framing:</legend><div class="s2s-portrait-mode-values"><input class="visually-hidden" type="radio" id="s2s-frame-mode-{{ section.id }}-frame" name="s2s-framing-mode" value="Frame" data-s2s-framing-mode checked><label for="s2s-frame-mode-{{ section.id }}-frame" class="s2s-portrait-mode">Frame</label><input class="visually-hidden" type="radio" id="s2s-frame-mode-{{ section.id }}-none" name="s2s-framing-mode" value="No frame" data-s2s-framing-mode><label for="s2s-frame-mode-{{ section.id }}-none" class="s2s-portrait-mode">No frame</label></div></fieldset>
            <fieldset class="s2s-portrait-option s2s-portrait-frame-styles" data-s2s-option-group="{{ forloop.index0 }}"><legend class="visually-hidden">{{ option.name | escape }}</legend><div class="s2s-portrait-frame-family"><p class="s2s-portrait-frame-heading">Classic styles:</p><div class="s2s-portrait-values">{% for value in option.values %}{% assign value_handle = value | handleize %}{% if value_handle == 'black' or value_handle == 'white' %}{% assign value_id = 's2s-option-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}{% assign swatch_position = 0 %}{% if value_handle == 'black' %}{% assign swatch_position = s2s_frame_black_image_position %}{% elsif value_handle == 'white' %}{% assign swatch_position = s2s_frame_white_image_position %}{% endif %}{% assign swatch_image = nil %}{% if swatch_position > 0 %}{% assign swatch_index = swatch_position | minus: 1 %}{% assign swatch_image = product.images[swatch_index] %}{% endif %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-option-{{ option.position }}" value="{{ value | escape }}" data-s2s-option="{{ option.position | minus: 1 }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}" class="s2s-portrait-value s2s-portrait-frame-value" data-s2s-frame-value="{{ value_handle }}"><span class="s2s-portrait-frame-swatch s2s-portrait-frame-swatch--{{ value_handle }}">{% if swatch_image %}{{ swatch_image | image_url: width: 240 | image_tag: loading: 'lazy', widths: '120,180,240', sizes: '76px', alt: value }}{% endif %}</span><span>{{ value | escape }}</span><small>See Details</small></label>{% endif %}{% endfor %}</div></div><div class="s2s-portrait-frame-family"><p class="s2s-portrait-frame-heading">Specialty styles:</p><div class="s2s-portrait-values">{% for value in option.values %}{% assign value_handle = value | handleize %}{% if value_handle == 'walnut' or value_handle == 'birch' %}{% assign value_id = 's2s-option-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}{% assign swatch_position = 0 %}{% if value_handle == 'walnut' %}{% assign swatch_position = s2s_frame_walnut_image_position %}{% elsif value_handle == 'birch' %}{% assign swatch_position = s2s_frame_birch_image_position %}{% endif %}{% assign swatch_image = nil %}{% if swatch_position > 0 %}{% assign swatch_index = swatch_position | minus: 1 %}{% assign swatch_image = product.images[swatch_index] %}{% endif %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-option-{{ option.position }}" value="{{ value | escape }}" data-s2s-option="{{ option.position | minus: 1 }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}" class="s2s-portrait-value s2s-portrait-frame-value" data-s2s-frame-value="{{ value_handle }}"><span class="s2s-portrait-frame-swatch s2s-portrait-frame-swatch--{{ value_handle }}">{% if swatch_image %}{{ swatch_image | image_url: width: 240 | image_tag: loading: 'lazy', widths: '120,180,240', sizes: '76px', alt: value }}{% endif %}</span><span>{{ value | escape }}</span><small>See Details</small></label>{% endif %}{% endfor %}</div></div>{% for value in option.values %}{% assign value_handle = value | handleize %}{% if value_handle == 'poster-only' %}{% assign value_id = 's2s-option-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-option-{{ option.position }}" value="{{ value | escape }}" data-s2s-option="{{ option.position | minus: 1 }}"{% if value == option.selected_value %} checked{% endif %} data-s2s-frame-value="{{ value_handle }}">{% endif %}{% endfor %}</fieldset>
          {% else %}
            <fieldset class="s2s-portrait-option s2s-portrait-size-option" data-s2s-option-group="{{ forloop.index0 }}"><legend>{{ option.name | escape }}: <span data-option-label>{{ option.selected_value | escape }}</span></legend><div class="s2s-portrait-values">{% for value in option.values %}{% assign value_id = 's2s-option-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}{% assign option_image = product.images[forloop.index0] %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-option-{{ option.position }}" value="{{ value | escape }}" data-s2s-option="{{ option.position | minus: 1 }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}" class="s2s-portrait-value s2s-portrait-size-value"><span class="s2s-portrait-option-visual">{% if option_image %}{{ option_image | image_url: width: 360 | image_tag: loading: 'lazy', widths: '120,180,240,360', sizes: '(min-width: 801px) 10vw, 29vw', alt: value }}{% endif %}</span><span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>
          {% endif %}
        {% endunless %}{% endfor %}
        <div class="s2s-portrait-step-nav"><button type="button" class="s2s-portrait-back" data-portrait-previous aria-label="Previous">&#8592;</button><button type="button" class="btn btn-primary" data-portrait-next>{{ 's2s.next' | t }} &#8594;</button></div>
      </div>
      <div class="s2s-portrait-step s2s-portrait-personalization" data-portrait-step="3" hidden>
        <h2 class="s2s-portrait-upload-title">Upload pet's photo</h2>
        {% for s2s_pet_index in (1..s2s_pet_count) %}
          {% capture s2s_photo_property %}Upload Pet Photo{% if s2s_pet_count > 1 %} {{ s2s_pet_index }}{% endif %}{% endcapture %}
          {% capture s2s_name_property %}Pet Name{% if s2s_pet_count > 1 %} {{ s2s_pet_index }}{% endif %}{% endcapture %}
          <div class="s2s-portrait-pet" data-s2s-pet-instance="{{ s2s_pet_index }}">
            <label class="s2s-portrait-upload" for="s2s-photo-{{ section.id }}-{{ s2s_pet_index }}"><span>Drag and drop your pet's photo{% if s2s_pet_count > 1 %} {{ s2s_pet_index }}{% endif %} or <u>Browse</u></span></label>
            <input class="visually-hidden" id="s2s-photo-{{ section.id }}-{{ s2s_pet_index }}" type="file" name="properties[{{ s2s_photo_property | strip | escape }}]" accept="image/jpeg,image/png,image/webp" required data-s2s-photo data-s2s-photo-instance="{{ s2s_pet_index }}">
            {% assign selected_photo_alt = 's2s.selected_photo' | t %}<div class="s2s-photo-preview" data-s2s-photo-preview="{{ s2s_pet_index }}" hidden>{% if product.featured_image %}{{ product.featured_image | image_url: width: 64, height: 64, crop: 'center' | image_tag: loading: 'lazy', alt: selected_photo_alt, class: 's2s-photo-image' }}{% endif %}<span data-s2s-photo-name></span></div>
            {% unless is_artwork %}<label for="s2s-name-{{ section.id }}-{{ s2s_pet_index }}">{{ s2s_name_property | strip | escape }}</label><input id="s2s-name-{{ section.id }}-{{ s2s_pet_index }}" type="text" name="properties[{{ s2s_name_property | strip | escape }}]" maxlength="40" autocomplete="off" required>{% endunless %}
          </div>
        {% endfor %}
        __S2S_PORTRAIT_PERSONALIZATION_ADDONS__
        <p>{{ 's2s.upload_hint' | t }}</p>
        <div class="s2s-portrait-step-nav"><button type="button" class="s2s-portrait-back" data-portrait-previous aria-label="Previous">&#8592;</button><button type="button" class="btn btn-primary" data-portrait-next>{{ 's2s.next' | t }} &#8594;</button></div>
      </div>
      <div class="s2s-portrait-step" data-portrait-step="4" hidden>
        __S2S_PORTRAIT_EXTRAS__
        <div class="s2s-portrait-purchase"><input type="hidden" name="quantity" value="1"><button class="btn btn-primary" type="submit" data-s2s-submit{% unless product.selected_or_first_available_variant.available %} disabled{% endunless %}>{{ 's2s.add_to_cart' | t }}</button></div>
        <div class="s2s-portrait-step-nav s2s-portrait-step-nav--back-only"><button type="button" class="s2s-portrait-back" data-portrait-previous aria-label="Previous">&#8592;</button></div>
      </div>
      <p class="s2s-form-status" role="status" data-s2s-status></p><script type="application/json" data-s2s-variants>{{ product.variants | json }}</script><script type="application/json" data-s2s-variant-media-map>{% render 's2s-portrait-variant-media-map', product: product %}</script>
    {% endform %}
  </div>
</section>
<script src="{{ 's2s-product-gallery.js' | asset_url }}" defer></script>
<script src="{{ 's2s-portrait-product-v2.js' | asset_url }}" defer></script>
<script src="{{ 's2s-variant-sync.js' | asset_url }}" defer></script>
{% schema %}{"name":"Portrait product","settings":[],"blocks":[{"type":"@app"}],"presets":[{"name":"Portrait product"}]}{% endschema %}`;

export function buildPortraitSection(contracts?: PortraitWorkflowContracts) {
  const cases = Object.entries(contracts?.products || {})
    .filter(
      ([handle, item]) =>
        Boolean(handle) && Number.isInteger(item.petCount) && item.petCount > 0,
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([handle, item], index) =>
        `${index === 0 ? "  case product.handle" : ""}\n    when '${handle.replaceAll("'", "")}'\n      assign s2s_pet_count = ${item.petCount}`,
    )
    .join("\n");
  const frameCases = Object.entries(contracts?.products || {})
    .filter(([, item]) => Object.keys(item.frameSwatches || {}).length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([handle, item], index) => {
      const values = item.frameSwatches || {};
      const position = (value: number | string | undefined) => typeof value === "number" ? value + 1 : 0;
      const asset = (value: number | string | undefined) => typeof value === "string" ? value.replaceAll("'", "") : "";
      return `${index === 0 ? "  case product.handle" : ""}\n    when '${handle.replaceAll("'", "")}'\n      assign s2s_frame_black_image_position = ${position(values.black)}\n      assign s2s_frame_white_image_position = ${position(values.white)}\n      assign s2s_frame_walnut_image_position = ${position(values.walnut)}\n      assign s2s_frame_birch_image_position = ${position(values.birch)}\n      assign s2s_frame_black_asset = '${asset(values.black)}'\n      assign s2s_frame_white_asset = '${asset(values.white)}'\n      assign s2s_frame_walnut_asset = '${asset(values.walnut)}'\n      assign s2s_frame_birch_asset = '${asset(values.birch)}'`;
    })
    .join("\n");
  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const renderAddOn = (
    addon: NonNullable<PortraitWorkflowContracts["addOns"]>[number],
  ) => {
    const handle = addon.handle.replace(/[^a-z0-9-]/gi, "");
    if (!handle) return "";
    const idSuffix = handle.replaceAll("-", "_");
    const markup = `{% assign s2s_addon_product = all_products['${handle}'] %}{% assign s2s_addon_variant = s2s_addon_product.selected_or_first_available_variant %}<div class="s2s-portrait-addon"><input id="s2s-portrait-addon-{{ section.id }}-${idSuffix}" type="checkbox" value="{{ s2s_addon_variant.id }}" data-price="{{ s2s_addon_variant.price }}" data-s2s-addon="${handle}"{% unless s2s_addon_variant.available %} disabled{% endunless %}><label for="s2s-portrait-addon-{{ section.id }}-${idSuffix}"><span>${escapeHtml(addon.label)} <span class="money">{{ s2s_addon_variant.price | money }}</span></span><small>${escapeHtml(addon.help)}</small></label><script type="application/json" data-s2s-addon-product="${handle}">{{ s2s_addon_product.variants | json }}</script></div>`;
    return handle === "s2s-artwork-proof-checkbox" || handle === "s2s-checkbox-santa-hat"
      ? `{% unless is_artwork %}${markup}{% endunless %}`
      : markup;
  };
  const addOns = (contracts?.addOns || []).filter(
    (addon) => addon.handle && addon.label,
  );
  const personalization = addOns
    .filter((addon) => addon.placement === "personalization")
    .map(renderAddOn)
    .join("\n");
  const extras = addOns
    .filter((addon) => addon.placement === "extras")
    .map(renderAddOn)
    .join("\n");
  const extrasFieldset = extras
    ? `<fieldset class="s2s-portrait-addons" data-s2s-addon-group><legend>Any Extras?</legend>${extras}</fieldset>`
    : "";
  return portraitSectionTemplate
    .replace("__S2S_PET_COUNT_CASES__", cases ? `${cases}\n  endcase` : "")
    .replace("__S2S_FRAME_SWATCH_CASES__", frameCases ? `${frameCases}\n  endcase` : "")
    .replace("__S2S_PORTRAIT_PERSONALIZATION_ADDONS__", personalization)
    .replace("__S2S_PORTRAIT_EXTRAS__", extrasFieldset);
}

export function buildPortraitVariantMediaSnippet(contracts?: PortraitWorkflowContracts) {
  const cases = Object.entries(contracts?.products || {})
    .filter(([, item]) => Object.keys(item.variantMedia || {}).length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([handle, item], index) => `${index === 0 ? "{% case product.handle %}" : ""}{% when '${handle.replaceAll("'", "")}' %}${JSON.stringify(item.variantMedia)}`)
    .join("");
  return cases ? `${cases}{% else %}{}{% endcase %}` : "{}";
}

export const portraitFrameStyleSnippet = String.raw`{% liquid
  assign black_index = black_position | minus: 1
  assign white_index = white_position | minus: 1
  assign walnut_index = walnut_position | minus: 1
  assign birch_index = birch_position | minus: 1
  assign black_image = product.images | slice: black_index, 1 | first
  assign white_image = product.images | slice: white_index, 1 | first
  assign walnut_image = product.images | slice: walnut_index, 1 | first
  assign birch_image = product.images | slice: birch_index, 1 | first
  capture black_url
    if black_position > 0 and black_image
      echo black_image | image_url: width: 240
    elsif black_asset != blank
      echo black_asset | asset_url
    endif
  endcapture
  capture white_url
    if white_position > 0 and white_image
      echo white_image | image_url: width: 240
    elsif white_asset != blank
      echo white_asset | asset_url
    endif
  endcapture
  capture walnut_url
    if walnut_position > 0 and walnut_image
      echo walnut_image | image_url: width: 240
    elsif walnut_asset != blank
      echo walnut_asset | asset_url
    endif
  endcapture
  capture birch_url
    if birch_position > 0 and birch_image
      echo birch_image | image_url: width: 240
    elsif birch_asset != blank
      echo birch_asset | asset_url
    endif
  endcapture
%}style="--s2s-frame-black-image:url({{ black_url | strip }});--s2s-frame-white-image:url({{ white_url | strip }});--s2s-frame-walnut-image:url({{ walnut_url | strip }});--s2s-frame-birch-image:url({{ birch_url | strip }})"`;

export const portraitSection = buildPortraitSection();

export const portraitStyles =
  String.raw`.s2s-portrait-pdp{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(23rem,.75fr);gap:clamp(2rem,4vw,4.5rem);padding-block:clamp(2rem,4vw,4rem)}.s2s-portrait-stage{position:relative;border-radius:1rem;background:#f7f7f7;overflow:hidden}.s2s-portrait-slide{margin:0}.s2s-portrait-slide img{display:block;width:100%;height:auto}.s2s-portrait-arrow{position:absolute;top:50%;translate:0 -50%;width:2.25rem;height:2.25rem;border:0;border-radius:50%;background:#cfa184;color:#fff;cursor:pointer}.s2s-portrait-arrow--previous{left:1rem}.s2s-portrait-arrow--next{right:1rem}.s2s-portrait-thumbs-viewport{width:100%;max-width:100%;margin-top:.85rem;overflow:hidden}.s2s-portrait-thumbs-viewport:focus-visible{outline:2px solid #1a2829;outline-offset:2px}.s2s-portrait-thumbs{display:flex;gap:.75rem;width:max-content;transition:transform .2s ease;will-change:transform}.s2s-portrait-thumb{flex:0 0 var(--s2s-thumb-size,140px);width:var(--s2s-thumb-size,140px);aspect-ratio:1/1;padding:.2rem;border:1px solid transparent;border-radius:.75rem;background:#f7f7f7;overflow:hidden;cursor:pointer}.s2s-portrait-thumb.is-active{border-color:#1a2829}.s2s-portrait-thumb img{display:block;width:100%;height:100%;object-fit:contain}.s2s-portrait-details{position:static;align-self:start}.s2s-portrait-details h1{margin:0 0 .65rem;font-size:clamp(2rem,3vw,2.75rem);line-height:1.05}.s2s-portrait-rating{display:flex;gap:.55rem;margin-bottom:1rem}.s2s-portrait-price{display:flex;gap:.65rem;align-items:baseline;margin-bottom:1.6rem;font-size:1.45rem}.s2s-portrait-price s{font-size:1.15rem;opacity:.6}.s2s-portrait-step{width:100%;max-width:486px}.s2s-portrait-option{margin:0 0 1.5rem;padding:0;border:0}.s2s-portrait-option legend{margin-bottom:.75rem}.s2s-portrait-option legend span{margin-left:.3rem}.s2s-portrait-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem}.s2s-portrait-value{display:block;text-align:center;cursor:pointer}.s2s-portrait-swatch{display:block;height:98px;border:1px solid transparent;border-radius:1rem;background:#fafafa;box-shadow:0 2px 2px #00000029;overflow:hidden}.s2s-portrait-values input:checked+.s2s-portrait-value .s2s-portrait-swatch,.s2s-portrait-values input:checked+.s2s-portrait-size-value .s2s-portrait-option-visual,.s2s-portrait-values input:checked+.s2s-portrait-frame-value{border-color:#111}.s2s-portrait-swatch img,.s2s-portrait-option-visual img{display:block;width:100%;height:100%;object-fit:contain}.s2s-portrait-swatch--soft-white{background:#fafafa}.s2s-portrait-swatch--dusty-pink{background:#e7d2c7}.s2s-portrait-swatch--charcoal-gray{background:#252525}.s2s-portrait-swatch--sage{background:#b7b7a6}.s2s-portrait-swatch--navy{background:#233447}.s2s-portrait-swatch--terracotta{background:#b96d52}.s2s-portrait-swatch--shiplap{background:repeating-linear-gradient(90deg,#fff 0 16px,#f5f5f5 16px 19px,#fff 19px 34px)}.s2s-portrait-swatch--buffalo-plaid{background-color:#7d080e;background-image:linear-gradient(90deg,transparent 50%,#0004 50%),linear-gradient(transparent 50%,#0005 50%);background-size:42px 42px}.s2s-portrait-value>span:last-of-type{display:block;margin-top:.5rem}.s2s-portrait-option-visual{display:block;height:98px;border:1px solid transparent;border-radius:.75rem;background:#f7f7f7;overflow:hidden}.s2s-portrait-mode-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.s2s-portrait-mode{display:flex;height:58px;align-items:center;justify-content:center;border:1px solid #1a2829;cursor:pointer;text-transform:uppercase}.s2s-portrait-mode-values input:first-of-type+.s2s-portrait-mode{border-radius:.6rem 0 0 .6rem}.s2s-portrait-mode-values input:last-of-type+.s2s-portrait-mode{border-radius:0 .6rem .6rem 0}.s2s-portrait-mode-values input:checked+.s2s-portrait-mode{background:#1a2829;color:#fff}.s2s-portrait-frame-family+.s2s-portrait-frame-family{margin-top:1.45rem}.s2s-portrait-frame-heading{margin:0 0:.55rem}.s2s-portrait-frame-styles .s2s-portrait-values{grid-template-columns:1fr;gap:.55rem}.s2s-portrait-frame-value{display:grid;min-height:94px;grid-template-columns:76px minmax(0,1fr) auto;align-items:center;gap:.8rem;padding:.45rem 1rem;border:1px solid transparent;border-radius:1rem;background:#f7f7f7;text-align:left}.s2s-portrait-frame-swatch{display:block;width:76px;height:64px;border-radius:.6rem;background:#eee;overflow:hidden}.s2s-portrait-frame-swatch img{display:block;width:100%;height:100%;object-fit:cover}.s2s-portrait-frame-value small{font-size:.75rem;font-style:italic;text-decoration:underline}.s2s-portrait-step[hidden]{display:none!important}.s2s-portrait-step-nav{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1.25rem}.s2s-portrait-step-nav>.btn{min-width:min(12rem,55%);height:42px;margin-left:auto;border-radius:2rem}.s2s-portrait-back{flex:0 0 42px;width:42px;height:42px;border:2px solid #1a2829;border-radius:50%;background:#fff;color:#1a2829}.s2s-portrait-summary{font-size:1.2rem;color:#c88762}.s2s-portrait-summary small{display:block;margin-top:.15rem;font-size:.82rem;color:#111}.s2s-portrait-guarantee{margin-top:1.25rem;padding:.65rem;text-align:center;border-radius:.4rem;background:#f7f7f7;font-weight:700}.s2s-portrait-personalization{margin-top:0}.s2s-portrait-upload-title{margin:0 0 1rem;font-size:1.15rem}.s2s-portrait-pet{margin-bottom:1.25rem}.s2s-portrait-upload{display:flex;min-height:4.75rem;align-items:center;justify-content:center;padding:1rem;border-radius:.4rem;background:#f2f0ef;cursor:pointer;text-align:center}.s2s-portrait-personalization input[type=text]{display:block;width:100%;margin:.4rem 0 1rem;padding:.75rem;border:1px solid #1a2829;border-radius:.25rem}.s2s-photo-preview{align-items:center;gap:.75rem;margin:.65rem 0}.s2s-photo-preview:not([hidden]){display:flex}.s2s-photo-preview img{width:64px;height:64px;object-fit:cover;border-radius:.5rem}.s2s-portrait-purchase{display:flex;align-items:center;gap:.6rem}.s2s-portrait-purchase button{box-sizing:border-box;width:100%;height:42px;border-radius:2rem}.s2s-portrait-step-nav--back-only{justify-content:flex-start}.s2s-form-status{min-height:1.5em;color:#8b322c}@media(max-width:800px){.s2s-portrait-pdp{grid-template-columns:1fr;gap:1.4rem;padding-top:1rem}.s2s-portrait-details{position:static}.s2s-portrait-details h1{font-size:1.85rem}.s2s-portrait-swatch,.s2s-portrait-option-visual{height:auto;aspect-ratio:1.33/1}.s2s-portrait-step-nav{gap:.65rem}}` +
  String.raw`.s2s-portrait-addons{margin:1.25rem 0;padding:0;border:0}.s2s-portrait-addons legend{margin-bottom:.6rem;font-size:1.15rem}.s2s-portrait-addon{display:grid;grid-template-columns:1.1rem minmax(0,1fr);gap:.55rem;margin:.75rem 0;align-items:start}.s2s-portrait-addon input{width:1rem;height:1rem;margin-top:.2rem}.s2s-portrait-addon label{display:grid;gap:.12rem}.s2s-portrait-addon small{color:#777;line-height:1.35}.s2s-portrait-addon .money{color:#c88f6f;font-weight:700}.s2s-portrait-form[aria-busy=true] [data-s2s-submit]{cursor:wait;opacity:.65}` +
  String.raw`.s2s-portrait-pdp{grid-template-columns:minmax(0,746px) minmax(23rem,486px);justify-content:center;gap:clamp(2rem,4vw,3.25rem)}.s2s-portrait-step{max-width:none}.s2s-portrait-step[data-portrait-step="2"]{max-width:486px}.s2s-portrait-swatch{position:relative}.s2s-portrait-option-surcharge{position:absolute;right:.35rem;bottom:.35rem;padding:.12rem .3rem;border-radius:.25rem;background:#172225;color:#fff;font-size:.68rem;line-height:1}.s2s-portrait-limited{display:inline-block;margin-top:.25rem;padding:.1rem .45rem;border-radius:1rem;background:#aeb5b6;color:#fff;font-size:.68rem;line-height:1.2}@media(max-width:800px){.s2s-portrait-pdp{grid-template-columns:1fr}.s2s-portrait-step[data-portrait-step="2"]{max-width:100%}}` +
  String.raw`@media(min-width:401px) and (max-width:800px){.s2s-portrait-option--primary .s2s-portrait-values{grid-template-columns:226.66px 162px 226.66px;gap:40.33px}.s2s-portrait-option--primary .s2s-portrait-value{width:202px;align-self:start;justify-self:center}.s2s-portrait-option--primary .s2s-portrait-value:has(.s2s-portrait-limited){width:100%}.s2s-portrait-size-option .s2s-portrait-values{grid-template-columns:repeat(3,162px);justify-content:space-between}.s2s-portrait-size-value{width:162px}.s2s-portrait-size-value .s2s-portrait-option-visual{height:auto;aspect-ratio:1.33/1}}` +
  String.raw`.s2s-portrait-pdp--artwork .s2s-portrait-option--primary .s2s-portrait-swatch{height:auto;aspect-ratio:1/1}.s2s-portrait-pdp--artwork .s2s-portrait-option--primary .s2s-portrait-value>span:last-of-type{height:31px;margin:0;line-height:31px}@media(min-width:401px) and (max-width:800px){.s2s-portrait-pdp--artwork .s2s-portrait-option--primary .s2s-portrait-values{width:75%;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem}.s2s-portrait-pdp--artwork .s2s-portrait-option--primary .s2s-portrait-value{width:100%;justify-self:stretch}}` +
  String.raw`.s2s-portrait-frame-heading{margin:0 0 .55rem}.s2s-portrait-frame-swatch{background-position:center;background-size:cover;background-repeat:no-repeat}.s2s-portrait-frame-swatch--black{background-image:var(--s2s-frame-black-image)}.s2s-portrait-frame-swatch--white{background-image:var(--s2s-frame-white-image)}.s2s-portrait-frame-swatch--walnut{background-image:var(--s2s-frame-walnut-image)}.s2s-portrait-frame-swatch--birch{background-image:var(--s2s-frame-birch-image)}.s2s-portrait-frame-swatch img{display:none}` +
  productScrollStyles("portrait") +
  String.raw`@media(min-width:992px){.s2s-portrait-pdp{grid-template-columns:minmax(0,1fr) 12px 526px 12px;gap:0;padding-inline:0}.s2s-portrait-gallery{grid-column:1}.s2s-portrait-details{grid-column:3;width:auto;margin:0;padding:12px 20px 0}}@media(min-width:401px) and (max-width:991px){.s2s-portrait-pdp{grid-template-columns:12px minmax(0,1fr) 12px;gap:0;padding-inline:0}.s2s-portrait-gallery,.s2s-portrait-details{grid-column:2;width:auto;margin:0}.s2s-portrait-details{padding-top:32px}}@media(max-width:400px){.s2s-portrait-pdp{grid-template-columns:12px minmax(0,1fr) 12px;gap:0;padding-inline:0}.s2s-portrait-gallery,.s2s-portrait-details{grid-column:2;width:auto;margin:0}.s2s-portrait-details{padding-top:32px}}`;

export const portraitCarouselEnhancement = String.raw`(()=>{document.querySelectorAll('[data-s2s-portrait-product]').forEach(root=>{const viewport=root.querySelector('[data-portrait-thumbs-viewport]'),track=root.querySelector('[data-portrait-thumbs-track]'),thumbs=[...root.querySelectorAll('[data-portrait-thumb]')];if(!viewport||!track||!thumbs.length)return;let start=0,size=0,perPage=1;const activeIndex=()=>Math.max(0,thumbs.findIndex(thumb=>thumb.classList.contains('is-active')));const render=()=>{viewport.scrollLeft=0;track.style.transform='translate3d(-'+(start*(size+12))+'px,0,0)'};const reveal=index=>{if(index<start)start=index;else if(index>=start+perPage)start=index-perPage+1;start=Math.max(0,Math.min(start,Math.max(0,thumbs.length-perPage)));render()};const layout=()=>{const width=viewport.clientWidth,preferred=matchMedia('(max-width: 800px)').matches?92:140;perPage=Math.max(1,Math.min(thumbs.length,Math.floor((width+12)/(preferred+12))));size=Math.max(1,(width-12*(perPage-1))/perPage);viewport.style.setProperty('--s2s-thumb-size',size+'px');start=Math.min(start,Math.max(0,thumbs.length-perPage));reveal(activeIndex())};const sync=()=>queueMicrotask(()=>reveal(activeIndex()));thumbs.forEach(thumb=>thumb.addEventListener('click',sync));root.querySelector('[data-portrait-previous]')?.addEventListener('click',sync);root.querySelector('[data-portrait-next]')?.addEventListener('click',sync);viewport.addEventListener('scroll',()=>{if(viewport.scrollLeft)viewport.scrollLeft=0},{passive:true});viewport.addEventListener('keydown',event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();(event.key==='ArrowLeft'?root.querySelector('[data-portrait-previous]'):root.querySelector('[data-portrait-next]'))?.click()});layout();if('ResizeObserver'in window)new ResizeObserver(layout).observe(viewport);else addEventListener('resize',layout)})})();`;
