import type { CatalogueProduct } from "../features/catalogue/types";
import { formatRetailValue } from "../features/catalogue/types";

interface Props { products: CatalogueProduct[]; onOpenProduct: (product: CatalogueProduct) => void }

export function ProductGrid({ products, onOpenProduct }: Props) {
  if (products.length === 0) return <div className="commerce-empty"><strong>No products match.</strong><span>Clear a filter or try another search.</span></div>;
  return <div className="commerce-product-grid">{products.map((product) => <article className="commerce-product-card" key={product.colourwayId}>
    <button type="button" className="commerce-product-open" aria-label={`View ${product.articleNo}`} onClick={() => onOpenProduct(product)}>
      <span className="commerce-media-stage">{product.mediaUrl
        ? <img src={product.mediaUrl} alt={`${product.articleNo} · ${product.colour}`} />
        : <span className="commerce-placeholder" role="img" aria-label={`Image unavailable for ${product.articleNo}`}><b>{product.articleNo}</b><small>Image arriving soon</small></span>}
      </span>
      <span className="commerce-card-copy"><strong>{product.articleNo}</strong><span>{product.brand}</span><span>{product.colour}</span><b>MRP {formatRetailValue(product.mrpMinor, product.currencyCode)}</b></span>
    </button>
  </article>)}</div>;
}
