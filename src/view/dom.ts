export function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = (parent?.ownerDocument ?? document).createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

export function setProps(node: HTMLElement, props: Record<string, string>): void {
  for (const [name, value] of Object.entries(props)) node.style.setProperty(name, value);
}
