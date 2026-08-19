export const guideImages = import.meta.glob<string>('../images/*-guide.png', {
  eager: true,
  import: 'default',
});

export function getGuideImageSrc(guideKey: string): string | undefined {
  return guideImages[`../images/${guideKey}-guide.png`];
}
