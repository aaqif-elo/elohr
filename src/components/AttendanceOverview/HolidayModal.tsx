import { HolidayType } from '@prisma/client';
import {createSignal, Show} from 'solid-js';

type HolidayModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (name: string, description: string) => void;
  date: Date;
};

export function HolidayModal(props: HolidayModalProps) {
  const [name, setName] = createSignal<string>(HolidayType.INTERNAL);
  const [description, setDescription] = createSignal('');

  const handleConfirm = () => {
    props.onConfirm(name(), description());
    // Reset form values
    setName(HolidayType.INTERNAL);
    setDescription('');
  };

  const formattedDate = () => {
    return props.date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <Show when={props.isOpen}>
      <div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
        <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-800">
          <h2 class="mb-4 text-xl font-semibold dark:text-white">Convert to Holiday</h2>

          <p class="mb-4 text-sm text-gray-600 dark:text-gray-300">
            Converting {formattedDate()} to a holiday
          </p>

          <div class="mb-4">
            <label
              class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200"
              for="holidayName"
            >
              Holiday Name*
            </label>
            <input
              id="holidayName"
              type="text"
              value={name()}
              onInput={e => setName(e.currentTarget.value)}
              class="w-full rounded border border-gray-300 p-2 dark:border-gray-600 dark:bg-neutral-700 dark:text-white"
              placeholder="Enter holiday name"
              required
            />
          </div>

          <div class="mb-6">
            <label
              class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200"
              for="holidayDescription"
            >
              Description (Optional)
            </label>
            <textarea
              id="holidayDescription"
              value={description()}
              onInput={e => setDescription(e.currentTarget.value)}
              class="w-full rounded border border-gray-300 p-2 dark:border-gray-600 dark:bg-neutral-700 dark:text-white"
              rows={3}
              placeholder="Enter holiday description"
              title="Holiday description"
            />
          </div>

          <div class="flex justify-end space-x-3">
            <button
              onClick={props.onClose}
              class="rounded px-4 py-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              class="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:bg-blue-300"
              disabled={!name().trim()}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
