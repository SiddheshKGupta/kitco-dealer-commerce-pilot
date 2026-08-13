const primary = ["Dashboard", "Orders", "Dispatch", "Credit Holds", "Dealers", "Catalogue"];
const operational = ["Catalogue Imports", "Media Library", "Size Sets", "Commercial Offerings", "Seasons", "Schemes", "Reports", "Audit Trail", "Settings"];

export function ControlNavigation() {
	return <aside className="control-nav" aria-label="KITCO Control navigation"><p>KITCO Control</p><nav>{primary.map((item) => <a href={`#${item.toLowerCase().replaceAll(" ", "-")}`} key={item} className={item === "Orders" ? "is-active" : undefined}>{item}</a>)}<span>Operations</span>{operational.map((item) => <a href={`#${item.toLowerCase().replaceAll(" ", "-")}`} key={item}>{item}</a>)}</nav></aside>;
}
