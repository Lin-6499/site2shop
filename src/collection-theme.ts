export const collectionSection = String.raw`{% if collection.handle contains 'harold-home-' %}{% render 's2s-harold-collection', collection: collection %}{% else %}<section class="s2s-collection" data-s2s-collection>
  <div class="container">
    <header class="s2s-collection__header">
      <h1>{{ collection.title | escape }}</h1>
      {% if collection.description != blank %}<div class="s2s-rte">{{ collection.description }}</div>{% endif %}
    </header>
    <form class="s2s-collection-sort" method="get" data-s2s-collection-sort>
      <label for="s2s-sort-by-{{ section.id }}">Sort by</label>
      <select id="s2s-sort-by-{{ section.id }}" name="sort_by" onchange="this.form.submit()">
        {% assign current_sort = collection.sort_by | default: collection.default_sort_by %}
        {% for option in collection.sort_options %}<option value="{{ option.value | escape }}"{% if option.value == current_sort %} selected{% endif %}>{{ option.name | escape }}</option>{% endfor %}
      </select>
    </form>
    {% paginate collection.products by 48 %}
      <ul class="s2s-collection-grid" role="list" data-s2s-collection-grid>
        {% for product in collection.products %}
          {% liquid
            assign image_loading = 'lazy'
            if forloop.index <= 4
              assign image_loading = 'eager'
            endif
          %}
          {% render 's2s-collection-product-card', product: product, collection: collection, image_loading: image_loading %}
        {% else %}
          <li class="s2s-collection__empty">{{ 's2s.collection_empty' | t }}</li>
        {% endfor %}
      </ul>
      {{ paginate | default_pagination }}
    {% endpaginate %}
  </div>
</section>{% endif %}
{% schema %}
{"name":"Reference collection","settings":[],"presets":[{"name":"Reference collection"}]}
{% endschema %}`;

export const collectionProductCardSnippet = String.raw`{% doc %}
Renders a product card for collection and listing grids.
@param {product} product - Product displayed by the card.
@param {collection} collection - Collection used to preserve the product URL context.
@param {string} image_loading - Eager or lazy image loading mode.
{% enddoc %}
<li class="s2s-collection-card" data-s2s-collection-card>
  <a class="s2s-collection-card__media" href="{{ product.url | within: collection }}">
    {% if product.featured_image %}
      {{ product.featured_image | image_url: width: 900 | image_tag: loading: image_loading, widths: '260,360,540,720,900', sizes: '(min-width: 990px) 25vw, 50vw', alt: product.featured_image.alt | default: product.title }}
    {% endif %}
  </a>
  <div class="s2s-collection-card__heading">
    <h2><a href="{{ product.url | within: collection }}">{{ product.title | escape }}</a></h2>
    <a class="s2s-collection-card__shop" href="{{ product.url | within: collection }}" data-s2s-collection-shop>{{ 's2s.collection_shop_now' | t }}</a>
  </div>
  <div class="s2s-collection-card__rating" data-s2s-rating-binding data-id="{{ product.id }}">{% render 's2s-product-rating', product: product, link_to_reviews: true, card: true %}</div>
  <div class="s2s-collection-card__price" data-s2s-collection-price>
    {% if product.compare_at_price_max > product.price %}<s>{{ product.compare_at_price_max | money }}</s>{% endif %}
    <span>{% if product.price_varies %}{{ 's2s.collection_from' | t }} {% endif %}{{ product.price | money }}</span>
  </div>
</li>`;

export const collectionStyles = String.raw`
.s2s-collection{padding-block:2.5rem clamp(3rem,6vw,5rem)}
.s2s-collection>.container{width:min(calc(100% - 8rem),82rem);max-width:82rem;padding-inline:0}
.s2s-visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.s2s-collection__header{text-align:center;margin:0 auto 2.5rem}
.s2s-collection__header.s2s-visually-hidden{margin:0!important}
.s2s-collection__header h1{margin:0 0 1rem}
.s2s-collection-sort{display:flex;justify-content:flex-end;align-items:center;margin:0 0 1rem}
.s2s-collection-sort label,.s2s-collection-sort select{min-height:42px;border:1px solid #e5e5e5;background:#fff;padding:.55rem .75rem}
.s2s-collection-sort select{min-width:10rem}
.s2s-collection-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));row-gap:clamp(2.75rem,4vw,4.5rem);column-gap:0;list-style:none;margin:0;padding:0}
.s2s-collection-card{display:flex;min-width:0;flex-direction:column;align-items:stretch;padding:.75rem}
.s2s-collection-card a{color:inherit;text-decoration:none}
.s2s-collection-card__media{display:block;overflow:hidden;border-radius:.65rem;background:#f7f7f7;aspect-ratio:1/1}
.s2s-collection-card__media img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .25s ease}
.s2s-collection-card__media:hover img{transform:scale(1.015)}
.s2s-collection-card__heading{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:.6rem;margin-top:.72rem}
.s2s-collection-card__heading h2{font-family:inherit;font-size:.92rem;font-weight:400;line-height:1.32;margin:0}
.s2s-collection-card__shop{display:inline-flex;min-height:32px;align-items:center;justify-content:center;border-radius:999px;background:#d0a185;color:#fff!important;font-size:.75rem;line-height:1;padding:.55rem 1rem;white-space:nowrap}
.s2s-collection-card__rating{margin-top:.28rem;font-size:.78rem;line-height:1;color:#172728}
.s2s-collection-card__rating:empty{display:none}
.s2s-collection-card__rating .s2s-rating-link{margin-bottom:.25rem}
.s2s-collection-card__price{display:flex;align-items:baseline;flex-wrap:wrap;gap:.28rem;margin-top:.2rem;font-size:.86rem;line-height:1.3}
.s2s-collection-card__price s{color:#777}
.s2s-collection-card__price span{color:#172728}
.s2s-collection__empty{grid-column:1/-1;text-align:center}
@media(max-width:989px){.s2s-collection>.container{width:calc(100% - .5rem);max-width:none}.s2s-collection-sort{display:none}.s2s-collection-grid{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:2.5rem}.s2s-collection-card{padding:.5rem}}
@media(max-width:479px){.s2s-collection{padding-block:2.5rem 2rem}.s2s-collection-grid{row-gap:2rem}.s2s-collection-card__heading{display:block}.s2s-collection-card__shop{margin-top:.55rem}.s2s-collection-card__heading h2{font-size:.86rem}}
`;
