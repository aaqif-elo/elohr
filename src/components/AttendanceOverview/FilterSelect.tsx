import {Component, createSignal, For, Show} from 'solid-js';

interface FilterSelectionProps {
  availableFilters: string[];
  selectedFilters: string[];
  onSelect: (filter: string) => void;
  onDeselect: (filter: string) => void;
}

const FilterSelection: Component<FilterSelectionProps> = props => {
  const [inputValue, setInputValue] = createSignal('');
  const [showDropdown, setShowDropdown] = createSignal(false);

  // Filter the available filters based on the input value
  const filteredAvailableFilters = () => {
    const query = inputValue().toLowerCase();
    return props.availableFilters.filter(filter => filter.toLowerCase().includes(query));
  };

  // Handle selecting or deselecting a filter
  const handleSelectOrDeselect = (filter: string) => {
    if (props.selectedFilters.includes(filter)) {
      props.onDeselect(filter); // Deselect if already selected
    } else {
      props.onSelect(filter); // Select if not already selected
    }
    setInputValue(''); // Clear the input after interaction
  };

  return (
    <div class="relative">
      {/* Selected Filters as Chips */}
      <div class="mb-2 flex flex-wrap gap-2">
        <For each={props.selectedFilters}>
          {filter => (
            <div class="flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-white dark:bg-blue-700">
              {filter}
              <button type="button" class="text-xs" onClick={() => props.onDeselect(filter)}>
                ×
              </button>
            </div>
          )}
        </For>
      </div>

      {/* Input Box for Filtering Chips */}
      <input
        type="text"
        placeholder="Search filters..."
        value={inputValue()}
        onInput={e => setInputValue(e.currentTarget.value)}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setShowDropdown(false)} // Delay to allow click on dropdown
        class="w-full rounded border p-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
      />

      {/* Dropdown List of Available Filters */}
      <Show when={showDropdown()}>
        <div class="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <For each={filteredAvailableFilters()}>
            {filter => (
              <div
                class={`flex cursor-pointer items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 ${
                  props.selectedFilters.includes(filter) ? 'bg-gray-200 dark:bg-neutral-700' : ''
                }`}
                onMouseDown={e => {
                  e.preventDefault(); // Prevent onBlur from hiding the dropdown
                  handleSelectOrDeselect(filter); // Select the filter
                }}
              >
                <span>{filter}</span>
                {/* Checkmark for selected items */}
                {props.selectedFilters.includes(filter) && <span class="text-blue-500">✓</span>}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default FilterSelection;
