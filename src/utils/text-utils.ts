export function getTextWithLowerFirstLetter(text: string) {
  return text[0].toLowerCase() + text.slice(1);
}

export function getRandomIntNumber(lowerBound: number, upperBound: number): number {
  return Math.round(Math.random() * (upperBound - lowerBound) + lowerBound);
}

export function generateRGBColor(): string {
  return `rgb(${getRandomIntNumber(50, 220)}, ${getRandomIntNumber(50, 220)}, ${getRandomIntNumber(
    50,
    220
  )})`;
}

const rgbRegExp = /rgba?\((\d+)\s?,\s?(\d+)\s?,\s?(\d+)\s?\)/;
export function shouldIUseDarkText(rgbColor: string | null | undefined): boolean {
  const match = rgbColor?.match(rgbRegExp);
  if (!match?.length) return true;

  const red = parseInt(match[1], 10);
  const green = parseInt(match[2], 10);
  const blue = parseInt(match[3], 10);
  let brightness: number;
  brightness = red * 299 + green * 587 + blue * 114;
  brightness = brightness / 255000;

  // values range from 0 to 1
  // anything greater than 0.5 should be bright enough for dark text
  return brightness >= 0.6;
}
