export function getPollutionColorGradient(score: number) {
  if (score < 0) {
    return 'hsl(0, 100%, 50%)';
  }
  //threshold (=0.187) should be the middle of the gradient
  const hue = Math.max(0.187 * 2 - score, 0) * 10 * 0.267 * 120;
  return ['hsl(', hue, ',100%, 50%)'].join('');
}

/*
function hslToRgb(h: number, s: number, l: number) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return (
    '#' +
    Math.round(r * 255).toString(16) +
    Math.round(g * 255).toString(16) +
    Math.round(b * 255).toString(16)
  );
}

function hueToRgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}*/
