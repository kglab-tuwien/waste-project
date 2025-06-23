import * as React from 'react';
import { useEffect } from 'react';

import { Typography } from '@mui/material';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';

export default function AlphaSlider({
  disabled,
  onSelect,
  alphaValues,
  weightPerStop,
  co2ePerKg,
}: {
  disabled: boolean;
  onSelect: (a: number) => void;
  alphaValues: number[];
  weightPerStop: number;
  co2ePerKg: number;
}) {
  const [selected, setSelected] = React.useState(0);
  const [marks, setMarks] = React.useState<
    { label: string; value: number; index: number }[]
  >([]);
  // f(distance, emission per stop) = which emission per distance justifies selected distance per stop
  useEffect(() => {
    setMarks(
      alphaValues.map((value, index) => ({
        label:
          value >= 1000
            ? (Math.round(value / 100) / 10).toString() + 'km'
            : value + 'm',
        value: Math.min(
          (value * 9) / Math.max(...alphaValues.slice(0, -1)),
          10,
        ),
        index: index,
      })),
    );
  }, [weightPerStop, co2ePerKg, alphaValues]);
  const handleChange = (event: Event, value: number | number[]) => {
    if (typeof value === 'number' && value >= 0 && value < alphaValues.length) {
      setSelected(value);
      onSelect(alphaValues[marks.find((x) => x.value === value)?.index || 0]);
    }
  };

  // emissions per bin
  // emissions per km
  // alpha = km / bin
  // opt over (emissions per bin) * dirty_stops + (emissions per km) * total distance
  return (
    <Box sx={{ width: 300 }}>
      <Typography id="discrete-slider" align="center">
        {'Max extra dist. per clean stop: ' +
          marks.map((x) => (x.value === selected ? x.label : '')).join('')}
      </Typography>
      <Slider
        disabled={disabled}
        aria-label="Restricted values"
        defaultValue={20}
        step={null}
        valueLabelDisplay="off"
        value={selected}
        onChange={handleChange}
        marks={marks.map((x) => ({
          value: x.value,
          label: '',
        }))}
        min={0}
        max={alphaValues.length - 1}
      />
    </Box>
  );
}
