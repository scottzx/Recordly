export function NumberField({
	label,
	value,
	onChange,
	min = 0,
	max,
	step = 1,
}: {
	label: string;
	value: number;
	onChange: (n: number) => void;
	min?: number;
	max?: number;
	step?: number;
}) {
	return (
		<label>
			{label}
			<input
				aria-label={label}
				type="number"
				key={value}
				defaultValue={Number(value.toFixed(3))}
				min={min}
				max={max}
				step={step}
				onBlur={(e) => {
					const n = Number(e.target.value);
					if (
						Number.isFinite(n) &&
						n >= min &&
						(max === undefined || n <= max) &&
						n !== value
					)
						onChange(n);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
				}}
			/>
		</label>
	);
}
