import { repairStateProductSection } from "./harold-state-product-repair.js";
import { repairPopArtSection } from "./harold-pop-art-repair.js";
import { popArtMediaContract } from "./harold-pop-art-media-contract.js";
import { repairHaroldOptionMedia } from "./harold-option-media-repair.js";
import { houseInspirationIcon } from './harold-house-source-style.js';
import { haroldPetFields, haroldConditionalExtrasScript } from './harold-conditional-extras.js';
import { haroldUploadAssets } from './harold-upload-theme.js';
import { haroldHouseUploadGuidance } from './harold-house-upload-guidance.js';

export const haroldProductContractStyles = String.raw`
.s2s-harold-image-option--generic .s2s-harold-image-values--columns-2{grid-template-columns:repeat(2,6.75rem)!important;width:auto;margin-inline:0}
.s2s-harold-image-option--generic .s2s-harold-image-values--columns-3{grid-template-columns:repeat(3,6.75rem)!important}
.s2s-harold-image-option--generic .s2s-harold-image-values--columns-4{grid-template-columns:repeat(4,6.75rem)!important}
[data-s2s-harold-pop-art] .s2s-harold-image-values--columns-2{grid-template-columns:repeat(2,minmax(0,1fr))!important;width:min(100%,23.375rem);margin-inline:auto}
@media (min-width:481px) and (max-width:800px){
  .s2s-harold-image-option--style .s2s-harold-image-values,[data-s2s-harold-pop-art] .s2s-harold-image-values--columns-2{width:min(100%,35.5rem)}
  [data-s2s-harold-hat] .s2s-harold-image-values--columns-2{grid-template-columns:repeat(2,10.5rem)!important}
}
@media (max-width:480px){
  .s2s-harold-image-option--style .s2s-harold-image-values,[data-s2s-harold-pop-art] .s2s-harold-image-values--columns-2{width:min(100%,15rem)!important;margin-inline:auto}
  .s2s-harold-image-option--generic .s2s-harold-image-values--columns-2,.s2s-harold-image-option--generic .s2s-harold-image-values--columns-3,.s2s-harold-image-option--generic .s2s-harold-image-values--columns-4{grid-template-columns:repeat(var(--s2s-columns,3),5rem)!important}
  .s2s-harold-image-values--columns-2{--s2s-columns:2}.s2s-harold-image-values--columns-3{--s2s-columns:3}.s2s-harold-image-values--columns-4{--s2s-columns:4}
  [data-s2s-harold-pop-art] .s2s-harold-image-values--columns-2{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  [data-s2s-harold-pop-art] .s2s-harold-image-values--columns-4,[data-s2s-harold-watercolor] .s2s-harold-image-values--columns-4{align-items:start;overflow:hidden}
  [data-s2s-harold-pop-art] .s2s-harold-image-values--columns-4 label:last-of-type,[data-s2s-harold-watercolor] .s2s-harold-image-values--columns-4 label:last-of-type{width:6.75rem}
}
`;

export const haroldSourceSwitchValueScript = String.raw`(()=>{document.querySelectorAll('[data-s2s-frame-switch]').forEach(group=>{const switches=group.querySelectorAll('input[type="radio"]');if(switches[1])switches[1].value='on'})})();`;

type HaroldField = {
  kind: "file" | "text" | "textarea";
  name: string;
  label: string;
  required?: boolean;
};

type HaroldFamilyConfig = {
  suffix: string;
  section: string;
  name: string;
  marker: string;
  optionSteps: number[];
  totalSteps: number;
  fields?: HaroldField[];
  fieldStep?: number;
  optionControls?: Array<"radio" | "select" | "framing">;
  imageOptionIndices?: number[];
  imageOptionOffsets?: Record<number, number>;
  imageOptionColumns?: Record<number, number>;
  cardFramingIndices?: number[];
  showExtras?: boolean;
  showQuantity?: boolean;
  showIntro?: boolean;
  showStepSummary?: boolean;
};

const houseStyleSwatches: Record<string, string> = {
  Traditional: "s2s-5a840ef9507bc2f0.jpeg",
  Modern: "s2s-016c59498b6f35da.jpeg",
  Sketch: "s2s-f3d014992494b52b.jpeg",
  Line: "s2s-fbbf830f726205db.jpeg",
};

const houseSizeSwatches: Record<string, string> = {
  '8x10"': "s2s-deee2468db04bb37.jpg",
  '12x16"': "s2s-7d0ce3eaf2357136.jpg",
  '18x24"': "s2s-709c71ab281b506e.jpg",
};

const houseFrameSwatches: Record<string, string> = {
  "Matte Black": "s2s-d99a0c72c6ff78f7.png",
  White: "s2s-5fabef444801f480.png",
  Birch: "s2s-b8d4f1d4600d10a1.png",
  Walnut: "s2s-9304bafae1995968.png",
};

const popArtColorSwatches: Record<string, string> = {
  Pistachio: "s2s-44a9ee92dc97e7f8.png",
  Lavender: "s2s-4f5cabe5469f912c.png",
  Peony: "s2s-076c0657a48563df.png",
  Tangerine: "s2s-a03f44ef70c5ea05.png",
};

function liquidSwatchCase(values: Record<string, string>) {
  return `{% assign s2s_swatch = blank %}{% case value %}${Object.entries(
    values,
  )
    .map(
      ([value, file]) =>
        `{% when '${value}' %}{% assign s2s_swatch = '${file}' | asset_url %}`,
    )
    .join("")}{% endcase %}`;
}

const families: HaroldFamilyConfig[] = [
  {
    suffix: "s2s-harold-house",
    section: "s2s-harold-house-product",
    name: "Harold house portrait",
    marker: "harold-house",
    optionSteps: [1, 2, 2],
    optionControls: ["radio", "radio", "framing"],
    totalSteps: 4,
    fieldStep: 3,
    showExtras: true,
    showIntro: false,
    showStepSummary: true,
    fields: [
      {
        kind: "file",
        name: "House photo",
        label: "Upload house photo",
        required: true,
      },
      {
        kind: "text",
        name: "Text Line 1",
        label: "Text Line 1 (eg. family name or address)",
      },
      { kind: "text", name: "Text Line 2", label: "Text Line 2 (eg. date)" },
      {
        kind: "textarea",
        name: "Notes for the designer (optional)",
        label: "Any notes for the artist?",
      },
    ],
  },
  {
    suffix: "s2s-harold-pop-art",
    section: "s2s-harold-pop-art-product",
    name: "Harold pop art",
    marker: "harold-pop-art",
    optionSteps: [1, 2, 2],
    optionControls: ["radio", "radio", "framing"],
    imageOptionIndices: [0, 1],
    imageOptionOffsets: { 0: 20, 1: 0 },
    imageOptionColumns: { 0: 2, 1: 4 },
    cardFramingIndices: [2],
    totalSteps: 4,
    fieldStep: 3,
    showExtras: true,
    fields: [
      {
        kind: "file",
        name: "House photo",
        label: "Upload house photo",
        required: true,
      },
      { kind: "text", name: "Text Line 1", label: "Text Line 1 (optional)" },
    ],
  },
  {
    suffix: "s2s-harold-watercolor",
    section: "s2s-harold-watercolor-product",
    name: "Harold watercolor",
    marker: "harold-watercolor",
    optionSteps: [1, 1],
    optionControls: ["radio", "framing"],
    imageOptionIndices: [0],
    imageOptionColumns: { 0: 4 },
    cardFramingIndices: [1],
    totalSteps: 3,
    fieldStep: 2,
    showExtras: true,
    fields: [
      {
        kind: "file",
        name: "House photo",
        label: "Upload house photo",
        required: true,
      },
      {
        kind: "text",
        name: "Text Line 1",
        label: "First Line Text (optional)",
      },
      {
        kind: "text",
        name: "Text Line 2",
        label: "Second Line Text (optional)",
      },
    ],
  },
  {
    suffix: "s2s-harold-gift-card",
    section: "s2s-harold-gift-card-product",
    name: "Harold gift card",
    marker: "harold-gift-card",
    showStepSummary: true,
    optionSteps: [],
    totalSteps: 3,
    fieldStep: 2,
    showExtras: true,
    fields: [
      { kind: "file", name: "House photo", label: "Upload house photo" },
      { kind: "text", name: "Text Line 1", label: "Text Line 1 (optional)" },
    ],
  },
  {
    suffix: "s2s-harold-print",
    section: "s2s-harold-print-product",
    name: "Harold art print",
    marker: "harold-print",
    optionSteps: [1, 1, 1],
    optionControls: ["radio", "select", "select"],
    totalSteps: 1,
    showQuantity: false,
  },
  {
    suffix: "s2s-harold-digital",
    section: "s2s-harold-digital-product",
    name: "Harold digital portrait",
    marker: "harold-digital",
    showStepSummary: true,
    optionSteps: [1, 0],
    imageOptionIndices: [0],
    imageOptionColumns: { 0: 3 },
    totalSteps: 3,
    fieldStep: 2,
    showExtras: true,
    fields: [
      {
        kind: "file",
        name: "House photo",
        label: "Upload house photo",
        required: true,
      },
      { kind: "text", name: "Text Line 1", label: "Text Line 1 (optional)" },
    ],
  },
  {
    suffix: "s2s-harold-hat",
    section: "s2s-harold-hat-product",
    name: "Harold state hat",
    marker: "harold-hat",
    optionSteps: [1, 1],
    optionControls: ["select", "radio"],
    imageOptionIndices: [1],
    imageOptionColumns: { 1: 2 },
    totalSteps: 1,
    showQuantity: true,
  },
  {
    suffix: "s2s-harold-wine-glass",
    section: "s2s-harold-wine-glass-product",
    name: "Harold wine glass",
    marker: "harold-wine-glass",
    optionSteps: [1],
    optionControls: ["select"],
    totalSteps: 1,
    showQuantity: true,
  },
  {
    suffix: "s2s-harold-house-mug",
    section: "s2s-harold-house-mug-product",
    name: "Harold house mug",
    marker: "harold-house-mug",
    showStepSummary: true,
    optionSteps: [],
    totalSteps: 3,
    fieldStep: 2,
    showExtras: true,
    fields: [
      {
        kind: "file",
        name: "House photo",
        label: "Upload house photo",
        required: true,
      },
      { kind: "text", name: "Text Line 1", label: "Text Line 1 (optional)" },
    ],
  },
];

const schema = (name: string) =>
  `{% schema %}${JSON.stringify({ name, settings: [], blocks: [{ type: "@app" }], presets: [{ name }] })}{% endschema %}`;

function nav(step: number, total: number) {
  if (total === 1) return "";
  return `<div class="s2s-harold-step-nav">${step > 1 ? '<button type="button" class="s2s-harold-back" data-s2s-step-previous aria-label="Previous">←</button>' : "<span></span>"}${step < total ? '<button type="button" class="btn btn-primary s2s-harold-next" data-s2s-step-next>NEXT →</button>' : ""}</div>`;
}

function optionMarkup(config: HaroldFamilyConfig, indices: number[]) {
  if (!indices.length) return "";
  return indices
    .map((index) => {
      if (config.optionSteps[index] === 0) {
        return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset hidden data-s2s-hidden-option data-s2s-option-group="{{ forloop.index0 }}"><legend>{{ option.name | escape }}</legend>{% for value in option.values %}<input type="radio" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}>{% endfor %}</fieldset>{% endif %}{% endfor %}{% endunless %}`;
      }
      const control = config.optionControls?.[index] || "radio";
      if (config.marker === "harold-pop-art" && index === 1) {
        const swatches = { '9x12': popArtMediaContract.swatches['9x12'], '12x16': popArtMediaContract.swatches['12x16'], '18x24': popArtMediaContract.swatches['18x24'] };
        return `{% for option in product.options_with_values %}{% if forloop.index0 == 1 %}<fieldset class="s2s-harold-option s2s-harold-image-option" data-s2s-option-group="1"><legend>Canvas Size:</legend><div class="s2s-pop-sizes">{% for value in option.values %}${liquidSwatchCase(swatches)}{% assign value_id = 's2s-pop-size-' | append: section.id | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-2" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}">{% if s2s_swatch != blank %}<img src="{{ s2s_swatch }}" width="108" height="108" alt="{{ value | escape }}">{% else %}<span class="s2s-pop-size-unavailable" aria-hidden="true"></span>{% endif %}<span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}`;
      }
      if (config.marker === "harold-print" && index === 1) {
        const selectMarkup = `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<div class="s2s-harold-option" data-s2s-option-group="{{ forloop.index0 }}"><label for="s2s-harold-option-{{ section.id }}-{{ option.position }}">{{ option.name | escape }}</label><select id="s2s-harold-option-{{ section.id }}-{{ option.position }}" name="option-{{ option.name | handleize }}" data-s2s-option-select>{% for value in option.values %}<option value="{{ value | escape }}"{% if value == option.selected_value %} selected{% endif %}>{{ value | escape }}</option>{% endfor %}</select></div>{% endif %}{% endfor %}{% endunless %}`;
        const radioMarkup = `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option" data-s2s-option-group="{{ forloop.index0 }}"><legend>{{ option.name | escape }}: <span data-option-label>{{ option.selected_value | escape }}</span></legend><div class="s2s-harold-values">{% for value in option.values %}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}"><span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
        return `{% if product.handle == 'in-my-homeowner-era-1-print-copy' %}${radioMarkup}{% else %}${selectMarkup}{% endif %}`;
      }
      if (control === "select") {
        return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<div class="s2s-harold-option" data-s2s-option-group="{{ forloop.index0 }}"><label for="s2s-harold-option-{{ section.id }}-{{ option.position }}">{{ option.name | escape }}</label><select id="s2s-harold-option-{{ section.id }}-{{ option.position }}" name="option-{{ option.name | handleize }}" data-s2s-option-select>{% for value in option.values %}<option value="{{ value | escape }}"{% if value == option.selected_value %} selected{% endif %}>{{ value | escape }}</option>{% endfor %}</select></div>{% endif %}{% endfor %}{% endunless %}`;
      }
      if (control === "framing") {
        const unframedCard = (values: string[]) =>
          `<div class="s2s-harold-frame-values s2s-harold-frame-values--unframed" data-s2s-unframed-values hidden>{% for value in option.values %}{% if ${values.map((value) => `value == '${value}'`).join(" or ")} %}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}{% assign s2s_unframed_image = blank %}{% for s2s_variant in product.variants %}{% if s2s_variant.options[${index}] == value and s2s_variant.featured_image != blank %}{% assign s2s_unframed_image = s2s_variant.featured_image %}{% break %}{% endif %}{% endfor %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %} data-s2s-unframed-value><label class="s2s-harold-frame-card" for="{{ value_id }}"><span class="s2s-harold-frame-swatch">{% if s2s_unframed_image != blank %}{{ s2s_unframed_image | image_url: width: 180 | image_tag: loading: 'eager', widths: '90,120,180', alt: '' }}{% endif %}</span><span><strong>{{ value | escape }}</strong></span></label>{% endif %}{% endfor %}</div>`;
        if (config.marker === "harold-house" && index === 2) {
          const frameCase = liquidSwatchCase(houseFrameSwatches);
          const frameItems = (values: string[]) =>
            `{% for value in option.values %}{% if ${values.map((value) => `value == '${value}'`).join(" or ")} %}${frameCase}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label class="s2s-harold-frame-card" for="{{ value_id }}">{% if s2s_swatch != blank %}<img src="{{ s2s_swatch }}" width="80" height="80" loading="eager" alt="">{% endif %}<span><strong>{{ value | escape }}</strong><small>See detail</small></span></label>{% endif %}{% endfor %}`;
          return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option s2s-harold-framing s2s-harold-framing--cards" data-s2s-framing-group data-s2s-option-group="{{ forloop.index0 }}"><legend>Framing:<span class="visually-hidden"> <span data-s2s-frame-option-label>{{ option.selected_value | escape }}</span></span></legend><div class="s2s-harold-frame-switch" data-s2s-frame-switch><input class="visually-hidden" type="radio" id="s2s-frame-on-{{ section.id }}" name="form-option-framing-swicher" value="on"{% unless option.selected_value == 'Canvas' or option.selected_value == 'Poster Only' %} checked{% endunless %}><label for="s2s-frame-on-{{ section.id }}">FRAME</label><input class="visually-hidden" type="radio" id="s2s-frame-off-{{ section.id }}" name="form-option-framing-swicher" value="off"{% if option.selected_value == 'Canvas' or option.selected_value == 'Poster Only' %} checked{% endif %}><label for="s2s-frame-off-{{ section.id }}">NO FRAME</label></div>${unframedCard(["Poster Only", "Canvas"])}<p class="s2s-harold-frame-heading" data-s2s-frame-heading>Classic styles:</p><div class="s2s-harold-frame-values" data-s2s-frame-values>${frameItems(["Matte Black", "White"])}</div><p class="s2s-harold-frame-heading" data-s2s-frame-heading>Specialty styles:</p><div class="s2s-harold-frame-values" data-s2s-frame-values>${frameItems(["Birch", "Walnut"])}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
        }
        if (config.cardFramingIndices?.includes(index)) {
          const frameCase = liquidSwatchCase({
            Black: houseFrameSwatches["Matte Black"],
            White: houseFrameSwatches.White,
            Birch: houseFrameSwatches.Birch,
            Walnut: houseFrameSwatches.Walnut,
          });
          const frameCards = (values: string[]) =>
            `{% for value in option.values %}{% if ${values.map((value) => `value == '${value}'`).join(" or ")} %}${frameCase}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label class="s2s-harold-frame-card" for="{{ value_id }}"><img src="{{ s2s_swatch }}" width="80" height="80" loading="eager" alt=""><span><strong>{{ value | escape }}</strong><small>See detail</small></span></label>{% endif %}{% endfor %}`;
          return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option s2s-harold-framing s2s-harold-framing--cards" data-s2s-framing-group data-s2s-option-group="{{ forloop.index0 }}"><legend>Framing:<span class="visually-hidden"> <span data-s2s-frame-option-label>{{ option.selected_value | escape }}</span></span></legend><div class="s2s-harold-frame-switch" data-s2s-frame-switch><input class="visually-hidden" type="radio" id="s2s-frame-on-{{ section.id }}" name="form-option-framing-swicher" value="on"{% unless option.selected_value == 'Canvas' or option.selected_value == 'Poster Only' %} checked{% endunless %}><label for="s2s-frame-on-{{ section.id }}">Frame</label><input class="visually-hidden" type="radio" id="s2s-frame-off-{{ section.id }}" name="form-option-framing-swicher" value="off"{% if option.selected_value == 'Canvas' or option.selected_value == 'Poster Only' %} checked{% endif %}><label for="s2s-frame-off-{{ section.id }}">No frame</label></div>${unframedCard(["Canvas", "Poster Only"])}<p class="s2s-harold-frame-heading" data-s2s-frame-heading>Classic styles:</p><div class="s2s-harold-frame-values" data-s2s-frame-values>${frameCards(["Black", "White"])}</div><p class="s2s-harold-frame-heading" data-s2s-frame-heading>Specialty styles:</p><div class="s2s-harold-frame-values" data-s2s-frame-values>${frameCards(["Birch", "Walnut"])}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
        }
        return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option s2s-harold-framing" data-s2s-framing-group data-s2s-option-group="{{ forloop.index0 }}"><legend>{{ option.name | escape }}: <span data-s2s-frame-option-label>{{ option.selected_value | escape }}</span></legend><div class="s2s-harold-frame-switch" data-s2s-frame-switch><input class="visually-hidden" type="radio" id="s2s-frame-on-{{ section.id }}" name="form-option-framing-swicher" value="on"{% unless option.selected_value == 'Canvas' or option.selected_value == 'Poster Only' %} checked{% endunless %}><label for="s2s-frame-on-{{ section.id }}">Frame</label><input class="visually-hidden" type="radio" id="s2s-frame-off-{{ section.id }}" name="form-option-framing-swicher" value="off"{% if option.selected_value == 'Canvas' or option.selected_value == 'Poster Only' %} checked{% endif %}><label for="s2s-frame-off-{{ section.id }}">No frame</label></div><div class="s2s-harold-values" data-s2s-frame-values><span hidden data-option-label>{{ option.selected_value | escape }}</span>{% for value in option.values %}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}{% if value == 'Canvas' or value == 'Poster Only' %} hidden{% endif %}><label for="{{ value_id }}"{% if value == 'Canvas' or value == 'Poster Only' %} hidden{% endif %}><span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
      }
      if (config.marker === "harold-house" && (index === 0 || index === 1)) {
        const style = index === 0;
        const swatchCase = liquidSwatchCase(
          style ? houseStyleSwatches : houseSizeSwatches,
        );
        if(style)return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == 0 %}<div class="s2s-harold-image-option--style mb-7 px-12 pt-4" data-s2s-option-group="0"><h4 class="h5 mb-3 text-center">Portrait Style:</h4><div>${houseInspirationIcon}<a href="/pages/inspiration-gallery" class="mb-7 px-12 pt-4">View Our Inspiration </a></div><ul class="color-swatches list-unstyled row row-cols-2 mx-n3 mb-0">{% for value in option.values %}${swatchCase}{% assign value_id = 's2s-harold-style-' | append: section.id | append: '-' | append: forloop.index0 %}<li class="p-3 text-center mb-4"><input class="product-option visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-1" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}" aria-label="{{ value | escape }}" class="w-100" style="cursor:pointer"><img src="{{ s2s_swatch }}" alt="{{ value | escape }}" width="480" height="480" class="img-fluid" loading="eager"><h6 class="mt-3 mb-2" style="font-family:var(--bs-body-font-family)">{{ value | escape }}</h6></label></li>{% endfor %}</ul></div>{% endif %}{% endfor %}{% endunless %}`;
        return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option s2s-harold-image-option s2s-harold-image-option--${style ? "style" : "size"}" data-s2s-option-group="{{ forloop.index0 }}"><legend>${style ? "Portrait Style:" : "Size:"}<span class="visually-hidden"> <span data-option-label>{{ option.selected_value | escape }}</span></span></legend>${style ? '<span class="s2s-harold-inspiration" aria-hidden="true">View Our Inspiration</span>' : ""}<div class="s2s-harold-image-values">{% for value in option.values %}${swatchCase}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}">{% if s2s_swatch != blank %}<span class="s2s-harold-swatch"><img src="{{ s2s_swatch }}" width="480" height="480" loading="eager" alt=""></span>{% endif %}<span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
      }
      if (config.marker === "harold-pop-art" && index === 0) {
        const swatchCase = liquidSwatchCase(popArtColorSwatches);
        return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option s2s-harold-image-option s2s-harold-image-option--style s2s-harold-pop-color" data-s2s-option-group="{{ forloop.index0 }}"><legend>Portrait Color:<span class="visually-hidden"> <span data-option-label>{{ option.selected_value | escape }}</span></span></legend><div class="s2s-harold-image-values s2s-harold-image-values--columns-2">{% for value in option.values %}${swatchCase}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}">{% if s2s_swatch != blank %}<span class="s2s-harold-swatch"><img src="{{ s2s_swatch }}" width="480" height="480" loading="eager" alt="{{ value | escape }}"></span>{% endif %}<span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
      }
      if (config.imageOptionIndices?.includes(index)) {
        const offset = config.imageOptionOffsets?.[index] || 0;
        const columns = config.imageOptionColumns?.[index] || 3;
        if (config.marker === "harold-hat" && index === 1) {
          return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == 1 %}<fieldset class="s2s-harold-option s2s-harold-image-option s2s-harold-image-option--generic" data-s2s-option-group="1"><legend>Color</legend><div class="s2s-harold-image-values s2s-harold-image-values--columns-2">{% for value in option.values %}{% assign s2s_color_key = value | handleize | append: '-front-' %}{% assign s2s_swatch_image = blank %}{% for s2s_image in product.images %}{% if s2s_image.src contains s2s_color_key %}{% assign s2s_swatch_image = s2s_image %}{% break %}{% endif %}{% endfor %}{% assign value_id = 's2s-harold-' | append: section.id | append: '-color-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-2" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}" aria-label="{{ value | escape }}">{% if s2s_swatch_image != blank %}<span class="s2s-harold-swatch">{{ s2s_swatch_image | image_url: width: 180 | image_tag: loading: 'eager', widths: '90,120,180', alt: value }}</span>{% endif %}<span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
        }
        return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option s2s-harold-image-option s2s-harold-image-option--generic" data-s2s-option-group="{{ forloop.index0 }}"><legend>{{ option.name | escape }}:<span class="visually-hidden"> <span data-option-label>{{ option.selected_value | escape }}</span></span></legend><div class="s2s-harold-image-values s2s-harold-image-values--columns-${columns}">{% for value in option.values %}{% assign s2s_image_index = forloop.index0 | plus: ${offset} %}{% assign s2s_swatch_image = product.images[s2s_image_index] %}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}">{% if s2s_swatch_image != blank %}<span class="s2s-harold-swatch">{{ s2s_swatch_image | image_url: width: 480 | image_tag: loading: 'eager', widths: '160,240,360,480', alt: value }}</span>{% endif %}<span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
      }
      return `{% unless product.has_only_default_variant %}{% for option in product.options_with_values %}{% if forloop.index0 == ${index} %}<fieldset class="s2s-harold-option" data-s2s-option-group="{{ forloop.index0 }}"><legend>{{ option.name | escape }}: <span data-option-label>{{ option.selected_value | escape }}</span></legend><div class="s2s-harold-values">{% for value in option.values %}{% assign value_id = 's2s-harold-' | append: section.id | append: '-' | append: option.position | append: '-' | append: forloop.index0 %}<input class="visually-hidden" type="radio" id="{{ value_id }}" name="s2s-harold-option-{{ option.position }}" value="{{ value | escape }}"{% if value == option.selected_value %} checked{% endif %}><label for="{{ value_id }}"><span>{{ value | escape }}</span></label>{% endfor %}</div></fieldset>{% endif %}{% endfor %}{% endunless %}`;
    })
    .join("");
}

function fieldMarkup(fields: HaroldField[], marker: string) {
  const house = marker === "harold-house";
  return fields
    .map((field, index) => {
      const id = `s2s-harold-field-{{ section.id }}-${index}`;
      const required = field.required ? " required" : "";
      if (field.kind === "file")
        return `<div class="s2s-harold-upload">${house ? `<h4 class="h5 mb-5"><label for="${id}">${field.label}:</label></h4>${haroldHouseUploadGuidance}` : `<label for="${id}">${field.label}${field.required ? " *" : ""}</label>`}<label class="s2s-harold-drop" for="${id}"><span aria-hidden="true">⇧</span><span>${house ? "Upload house photo" : "Upload photo"} or <u>Browse</u></span></label><input class="visually-hidden" id="${id}" type="file" name="properties[${field.name}]" accept="image/jpeg,image/png,image/webp"${field.required ? " required data-s2s-required-photo" : ""} data-s2s-photo>${house ? "" : "<p>JPG, PNG or WebP · maximum 10 MB.</p>"}</div>`;
      if (field.kind === "textarea")
        return `${house ? '<div class="s2s-harold-proof-guidance"><p>✅ Free proofs. Preview your artwork in 1-3 days.</p><p>✅ Edits included. Need a tree removed? Front door color changed? Add a note at checkout and we’ll take care of it.</p><p>✅ Unlimited revisions. We only print and ship when you’re 100% satisfied.</p><p>✅ For quick tips on photos, <a href="/pages/image-tips-guidelines">click here</a></p></div>' : ""}<label for="${id}">${field.label}</label><textarea id="${id}" name="properties[${field.name}]"${required}></textarea>`;
      return `<label${house ? ' class="form-label mb-2"' : ''} for="${id}">${field.label}${house ? ':' : ''}</label><input${house ? ' class="form-control mb-3"' : ''} id="${id}" type="text" name="properties[${field.name}]" maxlength="120"${required}>`;
    })
    .join("");
}

const extrasMarkup = String.raw`<fieldset class="s2s-family-addons s2s-harold-extras" data-s2s-addon-group><legend>Any Extras?</legend>
  {% assign s2s_skip_product = all_products['skip-the-line'] %}{% assign s2s_skip_variant = s2s_skip_product.selected_or_first_available_variant %}<div class="s2s-family-addon"><input id="s2s-harold-skip-{{ section.id }}" type="checkbox" value="{{ s2s_skip_variant.id }}" data-price="{{ s2s_skip_variant.price }}" data-s2s-addon="skip-the-line"{% unless s2s_skip_variant.available %} disabled{% endunless %}><span><label for="s2s-harold-skip-{{ section.id }}">Want your order sooner? <span class="money">{{ s2s_skip_variant.price | money }}</span></label><small>We'll move your illustration to the front of the line!</small></span><script type="application/json" data-s2s-addon-product="skip-the-line">{{ s2s_skip_product.variants | json }}</script></div>
  {% assign s2s_digital_product = all_products['digital-download'] %}{% assign s2s_digital_variant = s2s_digital_product.selected_or_first_available_variant %}<div class="s2s-family-addon"><input id="s2s-harold-digital-{{ section.id }}" type="checkbox" value="{{ s2s_digital_variant.id }}" data-price="{{ s2s_digital_variant.price }}" data-s2s-addon="digital-download"{% unless s2s_digital_variant.available %} disabled{% endunless %}><span><label for="s2s-harold-digital-{{ section.id }}">Digital Download <span class="money">{{ s2s_digital_variant.price | money }}</span></label><small>Receive a file of your artwork to share and print extras.</small></span><script type="application/json" data-s2s-addon-product="digital-download">{{ s2s_digital_product.variants | json }}</script></div>
  {% assign s2s_add_pet_product = all_products['add-a-pet-to-your-home-portrait'] %}{% assign s2s_add_pet_variant = s2s_add_pet_product.selected_or_first_available_variant %}<div class="s2s-family-addon"><input id="s2s-harold-add-pet-{{ section.id }}" type="checkbox" value="{{ s2s_add_pet_variant.id }}" data-price="{{ s2s_add_pet_variant.price }}" data-s2s-addon="add-a-pet-to-your-home-portrait"{% unless s2s_add_pet_variant.available %} disabled{% endunless %}><span><label for="s2s-harold-add-pet-{{ section.id }}">Add a Pet <span class="money">{{ s2s_add_pet_variant.price | money }}</span></label></span><script type="application/json" data-s2s-addon-product="add-a-pet-to-your-home-portrait">{{ s2s_add_pet_product.variants | json }}</script></div>
</fieldset>`;

const haroldExtrasMarkup=extrasMarkup
 .replaceAll("all_products['skip-the-line']", "all_products['harold-home-skip-the-line']")
 .replaceAll("all_products['digital-download']", "all_products['harold-home-digital-download']")
 .replaceAll("all_products['add-a-pet-to-your-home-portrait']", "all_products['harold-home-add-a-pet-to-your-home-portrait']")
 .replace('</fieldset>',haroldPetFields+'</fieldset>');

function section(config: HaroldFamilyConfig) {
  const stepBodies: string[] = [];
  for (let step = 1; step <= config.totalSteps; step++) {
    const indices = config.optionSteps
      .map((assigned, index) =>
        assigned === step || (step === 1 && assigned === 0) ? index : -1,
      )
      .filter((index) => index >= 0);
    const options = optionMarkup(config, indices);
    let fields =
      config.fieldStep === step && config.fields?.length
        ? `<div class="s2s-harold-personalization">${fieldMarkup(config.fields, config.marker)}</div>`
        : "";
    if(config.marker==='harold-print'&&step===1)fields+=`{% if product.handle == 'new-home-new-chapter-new-memories-1-print' %}<label for="s2s-print-note-{{ section.id }}">Note for customizations</label><textarea id="s2s-print-note-{{ section.id }}" name="properties[Note for customizations]"></textarea>{% endif %}`;
    const extras =
      step === config.totalSteps && config.showExtras ? haroldExtrasMarkup : "";
    const quantity = config.showQuantity
      ? `<label class="visually-hidden" for="s2s-harold-quantity-{{ section.id }}">Quantity</label><input id="s2s-harold-quantity-{{ section.id }}" type="number" name="quantity" min="1" value="1">`
      : `<input type="hidden" name="quantity" value="1">`;
    const submit = `<button class="btn btn-primary s2s-harold-next" type="submit" data-s2s-submit{% unless product.selected_or_first_available_variant.available %} disabled{% endunless %}>{% if product.selected_or_first_available_variant.available %}ADD TO CART{% else %}SOLD OUT{% endif %}</button>`;
    const purchase =
      step === config.totalSteps
        ? `<div class="s2s-harold-purchase">${quantity}${submit}</div>`
        : "";
    const summary = config.showStepSummary
      ? `<div class="mb-6 mb-lg-0"><p class="product-price-container fs-3 text-primary-darker mb-0 lh-sm">Subtotal: <span class="product-price-final" data-s2s-subtotal>{{ product.selected_or_first_available_variant.price | money }}</span></p><p class="fst-italic mb-0 text-center text-lg-start">Free shipping over $100</p></div>`
      : "";
    const controls =
      config.showStepSummary && step === config.totalSteps
        ? `<div class="s2s-harold-step-nav">${quantity}<button type="button" class="s2s-harold-back" data-s2s-step-previous aria-label="Previous">←</button>${submit}</div>`
        : `${purchase}${nav(step, config.totalSteps)}`;
    const readiness = config.showStepSummary
      ? `<div class="s2s-harold-ready">✓ <strong>Artwork Ready in 1-2 Days</strong></div>`
      : "";
    const summaryButtons=(step>1?'<button type="button" class="s2s-harold-back" data-s2s-step-previous aria-label="Previous">←</button>':'')+(step===config.totalSteps?quantity+submit.replace('s2s-harold-next','px-12 py-3 ls-1 text-uppercase'):'<button type="button" class="btn btn-primary px-12 py-3 ls-1 text-uppercase" data-s2s-step-next>NEXT →</button>');
    const bottom=config.showStepSummary?`<div class="d-flex flex-column flex-lg-row justify-content-between align-items-center">${summary}<div class="flex-shrink-0">${summaryButtons}</div></div>`:controls;
    stepBodies.push(`<div class="s2s-harold-step" data-s2s-step="${step}"${step===1?'':' hidden'}>${options}${fields}${extras}${bottom}${readiness}</div>`);
  }
  return String.raw`{{ 's2s-family-product.css' | asset_url | stylesheet_tag }}{{ 's2s-harold-product.css' | asset_url | stylesheet_tag }}
<section class="container s2s-harold-product" data-s2s-family-product data-s2s-harold-family="${config.marker}" data-s2s-harold-workflow data-s2s-${config.marker} data-s2s-total-steps="${config.totalSteps}" data-s2s-current-step="1" data-s2s-currency="{{ cart.currency.iso_code | default: shop.currency }}">
 <div class="s2s-harold-layout">
  <div class="s2s-harold-gallery-col">
   <div class="s2s-family-gallery s2s-harold-gallery">
    <div class="s2s-family-stage s2s-harold-stage">
      {% for image in product.images %}<figure class="s2s-family-slide" data-family-slide="{{ forloop.index0 }}"{% unless forloop.first %} hidden{% endunless %}>{{ image | image_url: width: 1600 | image_tag: loading: 'lazy', widths: '390,640,900,1200,1600', sizes: '(min-width: 801px) 56vw, 100vw', alt: image.alt | default: product.title }}</figure>{% endfor %}
    </div>
    <div class="s2s-harold-thumb-nav">{% if product.images.size > 1 %}<button type="button" class="s2s-family-arrow s2s-family-arrow--previous" data-family-previous aria-label="Previous image">←</button>{% endif %}<div class="s2s-family-thumbs-viewport" data-family-thumbs-viewport tabindex="0" aria-label="Product image thumbnails"><div class="s2s-family-thumbs" data-family-thumbs-track>{% for image in product.images %}<button type="button" class="s2s-family-thumb{% if forloop.first %} is-active{% endif %}" data-family-thumb="{{ forloop.index0 }}"{% if forloop.first %} aria-current="true"{% endif %}>{{ image | image_url: width: 300 | image_tag: loading: 'lazy', widths: '100,160,220,300', alt: image.alt | default: product.title }}</button>{% endfor %}</div></div>{% if product.images.size > 1 %}<button type="button" class="s2s-family-arrow s2s-family-arrow--next" data-family-next aria-label="Next image">→</button>{% endif %}</div>
   </div>
  </div>
  <div class="s2s-harold-info-col">
   <div id="product-content-area" class="s2s-harold-details">
    <h1>{{ product.title | escape }}</h1>
    <div class="s2s-harold-rating" data-s2s-product-rating-slot>{% content_for 'blocks' %}<span class="loox-rating s2s-product-rating s2s-rating-placeholder" data-s2s-product-rating data-s2s-rating-placeholder data-id="{{ product.id }}" aria-hidden="true"></span></div><style>.s2s-rating-placeholder{display:inline-flex;width:120px;height:19px;min-width:120px;min-height:19px}.s2s-harold-rating:has(.loox-rating:not([data-s2s-rating-placeholder])) .s2s-rating-placeholder{display:none}</style>
    <div class="s2s-harold-price"><s data-s2s-compare{% unless product.selected_or_first_available_variant.compare_at_price > product.selected_or_first_available_variant.price %} hidden{% endunless %}>{{ product.selected_or_first_available_variant.compare_at_price | money }}</s><strong data-s2s-price>{{ product.selected_or_first_available_variant.price | money }}</strong></div>
    ${config.showIntro === true ? '{% if product.description != blank %}<div class="s2s-harold-intro">{{ product.description | strip_html | truncatewords: 58 }}</div>{% endif %}' : ""}
    {% form 'product', product, class: 's2s-family-form s2s-harold-form', enctype: 'multipart/form-data' %}<div class="s2s-harold-payment-terms">{{ form | payment_terms }}</div>${stepBodies.join("")}<p class="s2s-form-status" role="status" data-s2s-status></p><script type="application/json" data-s2s-variants>{{ product.variants | json }}</script>{% endform %}${config.marker==='harold-print'?"{% render 's2s-harold-share-payments', product: product %}":''}
   </div>
  </div>
 </div>
</section><script src="{{ 's2s-product-gallery.js' | asset_url }}" defer></script><script src="{{ 's2s-family-product.js' | asset_url }}" defer></script><script src="{{ 's2s-harold-product.js' | asset_url }}" defer></script>${haroldUploadAssets}${schema(config.name)}`;
}

function renderFamily(family: HaroldFamilyConfig): string {
  const repaired = repairHaroldOptionMedia(repairPopArtSection(repairStateProductSection(section(family), family.marker), family.marker), family.marker);
  if (family.marker !== 'harold-print') return repaired;
  // Rendered reconnaissance found a distinct personalization workflow on this
  // product, despite its shared print suffix. Keep its form composition separate.
  const homeowner: HaroldFamilyConfig = {
    ...family, marker: 'harold-homeowner', optionSteps: [1, 1, 0],
    optionControls: ['radio', 'framing', 'radio'], cardFramingIndices: [1],
    totalSteps: 3, fieldStep: 2, showQuantity: false, showIntro: false,
    showExtras: true, showStepSummary: true,
    fields: [{kind:'file',name:'House photo',label:'Upload house photo',required:true},
      {kind:'text',name:'Text Line 1',label:'Text Line 1 (optional)'}],
  };
  const schemaTag = repaired.match(/\{% schema %\}[\s\S]*?\{% endschema %\}/)?.[0] || '';
  const strip = (s: string) => s.replace(/\{% schema %\}[\s\S]*?\{% endschema %\}/g,'');
  return "{% if product.handle == 'in-my-homeowner-era-1-print-copy' %}" +
    strip(repairHaroldOptionMedia(section(homeowner), homeowner.marker)) +
    '{% else %}' + strip(repaired) + '{% endif %}' + schemaTag;
}
export const haroldProductSections = Object.fromEntries(
  families.map((family) => [family.section, renderFamily(family)]),
);
export const haroldProductTemplates = families.map(({ suffix, section }) => ({
  suffix,
  section,
}));

export const haroldProductScript = String.raw`(()=>{document.querySelectorAll('[data-s2s-harold-workflow]').forEach(root=>{if(root.dataset.s2sHaroldReady)return;root.dataset.s2sHaroldReady='true';const form=root.querySelector('form');if(!form)return;const total=Number(root.dataset.s2sTotalSteps||1);let current=1;const status=form.querySelector('[data-s2s-status]');const show=(step,focusPanel=false)=>{const active=document.activeElement;if(active&&form.contains?.(active))active.blur();current=Math.max(1,Math.min(total,step));root.dataset.s2sCurrentStep=String(current);form.querySelectorAll('[data-s2s-step]').forEach(node=>node.hidden=Number(node.dataset.s2sStep)!==current);if(focusPanel&&matchMedia('(max-width:991.98px)').matches){requestAnimationFrame(()=>root.querySelector('.s2s-harold-details')?.scrollIntoView({block:'start',behavior:'instant'}))}};const currentPanel=()=>form.querySelector('[data-s2s-step="'+current+'"]');const valid=()=>{const panel=currentPanel();if(!panel)return true;const required=[...new Set(panel.querySelectorAll('[required],[data-s2s-required-photo]'))];for(const control of required){if(control.type==='file'){const file=control.files?.[0];if(!file||!/^(image\/jpeg|image\/png|image\/webp)$/.test(file.type)||file.size>10485760){status.textContent='Choose a JPG, PNG or WebP photo up to 10 MB.';return false}}else if(!control.checkValidity()){control.reportValidity();return false}}status.textContent='';return true};form.addEventListener('click',event=>{const previous=event.target.closest('[data-s2s-step-previous]');if(previous){event.preventDefault();show(current-1,true);return}const next=event.target.closest('[data-s2s-step-next]');if(next){event.preventDefault();if(valid())show(current+1,true)}});form.querySelectorAll('[data-s2s-option-select]').forEach(select=>select.addEventListener('change',()=>{const group=select.closest('[data-s2s-option-group]');const label=group?.querySelector('[data-option-label]');if(label)label.textContent=select.value}));form.querySelectorAll('[data-s2s-framing-group]').forEach(group=>{const switches=[...group.querySelectorAll('[data-s2s-frame-switch] input')],values=[...group.querySelectorAll('[data-s2s-frame-values] input')],unframedValues=[...group.querySelectorAll('[data-s2s-unframed-values] input')],allValues=[...values,...unframedValues],canvas=unframedValues.find(input=>['canvas','poster only'].includes(String(input.value).toLowerCase())),framed=values.find(input=>!['canvas','poster only'].includes(String(input.value).toLowerCase())),visibleLabel=group.querySelector('[data-s2s-frame-option-label]');const sync=()=>{const noFrame=switches[1]?.checked;group.querySelectorAll('[data-s2s-frame-values],[data-s2s-frame-heading]').forEach(node=>node.hidden=!!noFrame);group.querySelectorAll('[data-s2s-unframed-values]').forEach(node=>node.hidden=!noFrame);const desired=noFrame?canvas:((values.find(input=>input.checked))||framed);if(desired&&!desired.checked){desired.checked=true;desired.dispatchEvent(new Event('change',{bubbles:true}))}if(visibleLabel&&desired)visibleLabel.textContent=desired.value};switches.forEach(input=>input.addEventListener('change',sync));allValues.forEach(input=>input.addEventListener('change',()=>{if(visibleLabel&&input.checked)visibleLabel.textContent=input.value}));sync()});let variants=[];try{variants=JSON.parse(form.querySelector('[data-s2s-variants]')?.textContent||'[]')}catch{}const format=cents=>new Intl.NumberFormat(document.documentElement.lang||'en-US',{style:'currency',currency:root.dataset.s2sCurrency||'USD'}).format(cents/100);const refreshSubtotal=()=>{const selected=[...form.querySelectorAll('[data-s2s-option-group]')].map(group=>group.querySelector('input[type="radio"]:checked:not([name="form-option-framing-swicher"]),select')?.value||'');const variant=variants.find(item=>Array.isArray(item.options)&&item.options.every((value,index)=>value===selected[index]));const addons=[...form.querySelectorAll('[data-s2s-addon]:checked')].reduce((sum,input)=>sum+Number(input.dataset.price||0),0);root.querySelectorAll('[data-s2s-subtotal]').forEach(node=>node.textContent=format(Number(variant?.price||0)+addons))};form.addEventListener('change',refreshSubtotal);refreshSubtotal();show(1)})})();` + haroldConditionalExtrasScript;

export const haroldProductEnhancementScript = String.raw`(()=>{document.querySelectorAll('[data-s2s-harold-workflow]').forEach(root=>{const form=root.querySelector('form');if(!form)return;form.querySelectorAll('.s2s-harold-option legend').forEach(legend=>{const first=legend.firstChild;if(first?.nodeType===Node.TEXT_NODE)first.textContent=String(first.textContent||'').replace(/::\s*$/,': ')})})})();`;

// Browsers may scroll a below-the-fold step button into view before activation.
// The source workflow restores the information column after every transition.
export const haroldStepScrollScript = String.raw`(()=>{document.querySelectorAll('[data-s2s-harold-workflow]').forEach(root=>{const form=root.querySelector('form');if(!form||root.dataset.s2sStepScrollReady)return;root.dataset.s2sStepScrollReady='true';form.addEventListener('click',event=>{if(!event.target.closest('[data-s2s-step-next],[data-s2s-step-previous]')||matchMedia('(max-width:991.98px)').matches)return;requestAnimationFrame(()=>root.querySelector('.s2s-harold-details')?.scrollIntoView({block:'start',behavior:'instant'}))})})})();`;

export const haroldProductStyles =
  String.raw`.s2s-harold-product{display:grid;grid-template-columns:minmax(0,1fr) minmax(22rem,30.375rem);gap:clamp(2rem,3.4vw,4rem);padding-block:clamp(2rem,4vw,4.5rem);align-items:start}.s2s-harold-product>*{min-width:0}.s2s-harold-stage{aspect-ratio:1/1;background:#f7f7f7}.s2s-harold-stage .s2s-family-slide,.s2s-harold-stage .s2s-family-slide img{width:100%;height:100%;object-fit:contain}.s2s-harold-details{position:static;align-self:start}.s2s-harold-details h1{margin:0 0 .6rem;font-size:2.5rem;line-height:1.2}.s2s-harold-rating{min-height:1.5rem;margin:.25rem 0 .8rem}.s2s-harold-price{display:flex;align-items:baseline;gap:.55rem;margin-bottom:1.25rem;font-size:1.45rem}.s2s-harold-price s{font-size:1.05rem;opacity:.6}.s2s-harold-intro{margin-bottom:1.4rem;line-height:1.55}.s2s-harold-step[hidden]{display:none!important}.s2s-harold-option{margin:0 0 1.25rem;padding:0;border:0}.s2s-harold-option legend{margin-bottom:.55rem}.s2s-harold-values,.s2s-harold-frame-switch{display:flex;flex-wrap:wrap;gap:.55rem}.s2s-harold-values label,.s2s-harold-frame-switch label{display:inline-flex;min-height:2.35rem;align-items:center;justify-content:center;padding:.45rem .85rem;border:1px solid #1a2829;border-radius:2rem;cursor:pointer}.s2s-harold-values input:checked+label,.s2s-harold-frame-switch input:checked+label{background:#1a2829;color:#fff}.s2s-harold-frame-switch{margin-bottom:.7rem}.s2s-harold-option select,.s2s-harold-personalization input[type=text],.s2s-harold-personalization textarea{display:block;width:100%;min-height:42px;margin:.4rem 0 1rem;padding:.65rem .75rem;border:1px solid #1a2829;border-radius:.25rem;background:#fff}.s2s-harold-personalization textarea{min-height:6rem}.s2s-harold-upload>label:first-child{display:block;margin-bottom:.45rem}.s2s-harold-drop{display:flex;min-height:4.8rem;align-items:center;justify-content:center;gap:.6rem;padding:1rem;border-radius:.35rem;background:#f2f0ef;cursor:pointer}.s2s-harold-upload p{margin:.5rem 0 1rem;font-size:.8rem;color:#666}.s2s-harold-summary{display:grid;gap:.15rem;margin-top:1rem}.s2s-harold-summary strong{font-size:1.2rem}.s2s-harold-summary small{font-style:italic}.s2s-harold-step-nav{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:1.2rem}.s2s-harold-step-nav>input[type=hidden]{display:none}.s2s-harold-next{margin-left:auto;min-width:min(13rem,55%);height:42px;border-radius:2rem}.s2s-harold-back{flex:0 0 42px;width:42px;height:42px;border:2px solid #1d3f3e;border-radius:999px;background:transparent;color:#1d3f3e}.s2s-harold-ready{margin-top:1rem;padding:.65rem;text-align:center;border-radius:.4rem;background:#f7f7f7}.s2s-harold-purchase{display:flex;align-items:center;gap:.6rem}.s2s-harold-purchase input{box-sizing:border-box;flex:0 0 7.5rem;width:7.5rem;height:42px;padding:.55rem .8rem;border:1px solid #d9bba9;border-radius:2rem}.s2s-harold-purchase button{box-sizing:border-box;flex:1;height:42px;border-radius:2rem}.s2s-harold-thumb-nav{position:relative;margin-top:.85rem}.s2s-harold-product .s2s-family-thumbs-viewport{margin-top:0;overflow:hidden}.s2s-harold-product .s2s-family-thumbs{scrollbar-width:none}.s2s-harold-product .s2s-family-thumbs::-webkit-scrollbar{display:none}.s2s-harold-thumb-nav .s2s-family-arrow{z-index:2;top:50%;width:2rem;height:2rem;translate:0 -50%;background:#1d3f3e}.s2s-harold-thumb-nav .s2s-family-arrow--previous{left:-1rem}.s2s-harold-thumb-nav .s2s-family-arrow--next{right:-1rem}.s2s-harold-image-option{position:relative}.s2s-harold-image-option legend{font-weight:600}.s2s-harold-inspiration{position:absolute;top:0;right:0;text-decoration:underline;text-underline-offset:.15em}.s2s-harold-image-values{display:grid;gap:1rem}.s2s-harold-image-option--style .s2s-harold-image-values{grid-template-columns:repeat(2,minmax(0,1fr));width:min(100%,23.375rem);margin-inline:auto}.s2s-harold-image-option--size .s2s-harold-image-values{grid-template-columns:repeat(3,minmax(0,1fr))}.s2s-harold-image-option--generic .s2s-harold-image-values{grid-template-columns:repeat(4,minmax(0,1fr))}.s2s-harold-image-option--generic .s2s-harold-image-values--2{grid-template-columns:repeat(2,minmax(0,7.25rem));}.s2s-harold-image-option--generic .s2s-harold-image-values--3{grid-template-columns:repeat(3,minmax(0,1fr))}.s2s-harold-image-values label{display:grid;gap:.4rem;cursor:pointer;text-align:center}.s2s-harold-swatch{display:block;aspect-ratio:1/1;border:1px solid transparent;border-radius:1rem;overflow:hidden;background:#f8f8f8;box-shadow:0 2px 5px #0001}.s2s-harold-swatch img{display:block;width:100%;height:100%;object-fit:cover}.s2s-harold-image-values input:checked+label .s2s-harold-swatch{border-color:#1f2021;box-shadow:0 2px 5px #0002}.s2s-harold-framing--cards .s2s-harold-frame-switch{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:1.4rem}.s2s-harold-framing--cards .s2s-harold-frame-switch label{height:3.625rem;border-radius:0;background:#f8f8f8}.s2s-harold-framing--cards .s2s-harold-frame-switch label:first-of-type{border-radius:999px 0 0 999px}.s2s-harold-framing--cards .s2s-harold-frame-switch label:last-of-type{border-radius:0 999px 999px 0}.s2s-harold-framing--cards .s2s-harold-frame-switch input:checked+label{background:#1d3f3e;color:#fff}.s2s-harold-frame-heading{margin:1rem 0 .55rem;font-weight:600}.s2s-harold-frame-values{display:grid;gap:.5rem}.s2s-harold-frame-card{display:flex;min-height:7.125rem;align-items:center;gap:1rem;padding:1rem;border:1px solid transparent;border-radius:1rem;background:#f8f8f8;cursor:pointer}.s2s-harold-frame-card img{flex:0 0 5rem;width:5rem;height:5rem;object-fit:cover;border-radius:.5rem}.s2s-harold-frame-card span{display:grid;gap:.2rem}.s2s-harold-frame-card small{text-decoration:underline;text-underline-offset:.15em}.s2s-harold-frame-values input:checked+.s2s-harold-frame-card{border-color:#1f2021}.s2s-harold-frame-values[hidden],.s2s-harold-frame-heading[hidden]{display:none!important}@media(max-width:800px){.s2s-harold-product{grid-template-columns:minmax(0,1fr);gap:1.4rem;width:100%;max-width:100%;padding:1rem}.s2s-harold-details h1{font-size:clamp(1.8rem,8vw,2.35rem)}.s2s-harold-stage{aspect-ratio:auto;min-height:0}.s2s-harold-stage .s2s-family-slide,.s2s-harold-stage .s2s-family-slide img{height:auto}.s2s-harold-purchase input{flex-basis:6.2rem;width:6.2rem}.s2s-harold-thumb-nav .s2s-family-arrow--previous{left:.15rem}.s2s-harold-thumb-nav .s2s-family-arrow--next{right:.15rem}}@media(max-width:480px){.s2s-harold-image-values{gap:.7rem}.s2s-harold-image-option--style .s2s-harold-image-values{width:100%}.s2s-harold-frame-card{min-height:6rem;padding:.75rem}.s2s-harold-frame-card img{flex-basis:4.25rem;width:4.25rem;height:4.25rem}}` +
  String.raw`.s2s-harold-extras{margin:1.4rem 0;padding:0;border:0}.s2s-harold-extras legend{margin-bottom:.6rem;font-size:1.15rem}.s2s-harold-extras .s2s-family-addon{display:grid;grid-template-columns:1.1rem minmax(0,1fr);gap:.55rem;margin:.75rem 0;align-items:start}.s2s-harold-extras input{width:1rem;height:1rem;margin-top:.2rem}.s2s-harold-extras label{display:grid;gap:.12rem}.s2s-harold-extras small{color:#777;line-height:1.35}.s2s-harold-extras .money{color:#c88f6f;font-weight:700}` +
  String.raw`.s2s-harold-payment-terms:not(:empty){margin:-.55rem 0 1.25rem}.s2s-harold-framing--cards .s2s-harold-frame-switch input:checked+label{background:#f8f8f8;color:#1a2829}.s2s-harold-framing--cards .s2s-harold-frame-switch input:checked+label::before{content:"✓";margin-right:.3rem;font-weight:700}.s2s-harold-frame-values--unframed{grid-template-columns:1fr}.s2s-harold-frame-values--unframed .s2s-harold-frame-card{min-height:7.125rem}.s2s-harold-frame-values--unframed .s2s-harold-frame-swatch{display:block;flex:0 0 5rem;width:5rem;height:5rem;border-radius:.5rem;overflow:hidden;background:#eee}.s2s-harold-frame-values--unframed .s2s-harold-frame-swatch img{display:block;width:100%;height:100%;object-fit:cover}[data-s2s-harold-house] .s2s-harold-upload-guidance{margin:.65rem 0 1rem;text-align:center;font-style:italic;line-height:1.45;color:#3f4748}[data-s2s-harold-house] .s2s-harold-personalization input[type=text]{border-color:#e6e6e6;border-radius:999px}[data-s2s-harold-house] .s2s-harold-proof-guidance{display:grid;gap:.55rem;margin:.85rem 0 1.15rem}[data-s2s-harold-house] .s2s-harold-proof-guidance p{margin:0;line-height:1.45}[data-s2s-harold-house] .s2s-harold-proof-guidance a{text-decoration:underline;text-underline-offset:.15em}`;
