export const looxStarRatingBlockType =
  "shopify://apps/loox-reviews/blocks/loox-rating/5c3b337f-fd14-4df5-b1d6-80ec13e6e28e";

export const looxReviewsWidgetBlockType =
  "shopify://apps/loox-reviews/blocks/loox-dynamic-section/5c3b337f-fd14-4df5-b1d6-80ec13e6e28e";

export const looxCoreEmbedBlockType =
  "shopify://apps/loox-reviews/blocks/loox-inject/5c3b337f-fd14-4df5-b1d6-80ec13e6e28e";

export const looxThemeSettings = {
  current: {
    blocks: {
      "17925481342610000001": {
        type: looxCoreEmbedBlockType,
        disabled: false,
        settings: {},
      },
    },
  },
};

export const looxRatingSnippet = String.raw`{% doc %}
Renders a provider-neutral product rating backed by target-store review data.
@param {product} product - Product whose published rating is displayed.
@param {boolean} [link_to_reviews] - Link the rating to the product reviews widget.
@param {boolean} [card] - Link from a listing card to the product review widget.
{% enddoc %}
{% liquid
  assign s2s_rating = product.metafields.loox.avg_rating
  assign s2s_rating_count = product.metafields.loox.num_reviews
  assign s2s_rating_source = 'loox'
  if s2s_rating == blank
    assign s2s_rating = product.metafields.reviews.rating.value.rating
    assign s2s_rating_source = 'shopify'
  endif
  if s2s_rating_count == blank
    assign s2s_rating_count = product.metafields.reviews.rating_count.value
  endif
  assign s2s_rating_count_number = s2s_rating_count | plus: 0
  assign s2s_rating_percent = s2s_rating | times: 20 | at_most: 100 | at_least: 0
%}
{% if product != blank and s2s_rating != blank and s2s_rating_count_number > 0 %}
  {% assign s2s_rating_href = '#looxReviewsFrame' %}
  {% if card %}{% assign s2s_rating_href = product.url | append: '#looxReviewsFrame' %}{% endif %}
  {% if link_to_reviews %}<a class="s2s-rating-link" href="{{ s2s_rating_href }}" aria-label="{{ s2s_rating }} out of 5 stars, {{ s2s_rating_count_number }} reviews">{% endif %}
  <span class="loox-rating s2s-product-rating" data-s2s-product-rating data-s2s-rating-source="{{ s2s_rating_source }}" data-id="{{ product.id }}" data-rating="{{ s2s_rating }}" data-raters="{{ s2s_rating_count_number }}">
    <span class="s2s-rating-fallback" aria-hidden="true" style="--s2s-rating-percent:{{ s2s_rating_percent }}%">★★★★★</span>
    <span class="s2s-rating-count" aria-hidden="true">({{ s2s_rating_count_number }})</span>
  </span>
  {% if link_to_reviews %}</a>{% endif %}
{% endif %}`;

/**
 * Target-store Loox blocks captured from Shopify's theme editor.
 * Keep this generator-owned so rebuilding a theme cannot discard the app integration.
 */
export const looxReviewsSection = {
  type: "apps",
  blocks: {
    loox_reviews_widget: {
      type: looxReviewsWidgetBlockType,
      settings: {
        reviews_to_display: "",
        default_tab: "automatic",
        only_photos: false,
        aggregated: false,
        limit: 20,
        hide_thumbnails: false,
        maxwidth: 1280,
        is_sample: false,
      },
    },
  },
  block_order: ["loox_reviews_widget"],
  settings: {},
} as const;
