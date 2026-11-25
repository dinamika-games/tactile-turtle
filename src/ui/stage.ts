// The stage: where the pictures (SVG) are shown, fitted to the screen.

/**
 * Size the pictures of the stage to the screen (tablets in landscape and
 * portrait, laptops): as large as possible, keeping their proportions. Two
 * pictures side by side (the demo's plate and screen) share the space; in
 * portrait they stand one above the other.
 */
export function fitToScreen(root: HTMLElement): void {
  const pictures = [...root.querySelectorAll<SVGSVGElement>(":scope > svg, :scope > .pair > svg")];
  // The space of the stage (it is smaller while the webcam is shown beside it).
  const style = getComputedStyle(root);
  const width = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const portrait = height > width;
  const two = pictures.length > 1;
  const gap = two ? 0.02 * (portrait ? height : width) : 0;
  const availableWidth = portrait || !two ? width : (width - gap) / 2;
  const availableHeight = !portrait || !two ? height : (height - gap) / 2;
  for (const picture of pictures) {
    const box = picture.viewBox.baseVal;
    const aspect = box && box.width > 0 ? box.width / box.height : 1.6;
    picture.style.width = `${Math.floor(Math.min(availableWidth, availableHeight * aspect))}px`;
    picture.style.height = "auto";
  }
}

export function showOn(stage: HTMLElement, html: string): void {
  stage.innerHTML = html;
  fitToScreen(stage);
}
