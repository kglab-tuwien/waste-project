import * as React from 'react';
import { useEffect } from 'react';

import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';

export default function DayPicker({
  onSelect,
  days,
}: {
  onSelect: (a: string) => void;
  days: string[];
}) {
  const [value, setValue] = React.useState<Dayjs | null | undefined>(
    dayjs(days[0]),
  );
  useEffect(() => {
    if (
      days.length > 0 &&
      !(value && days.includes(value.format('YYYY-MM-DD')))
    ) {
      setValue(dayjs(days[0]));
      onSelect(days[0]);
    }
  }, [days, onSelect, value]);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DatePicker
        label="Controlled picker"
        defaultValue={value}
        value={value}
        format={'YYYY-MM-DD'}
        shouldDisableDate={(day) => !days.includes(day.format('YYYY-MM-DD'))}
        onChange={(newValue) => {
          setValue(newValue);
          newValue && onSelect(newValue.format('YYYY-MM-DD'));
        }}
      />
    </LocalizationProvider>
  );
}
