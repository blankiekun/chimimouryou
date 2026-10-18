<script lang="ts">
  import {
    faCancel,
    faChevronLeft,
    faChevronRight,
    faEdit,
    faRotate,
    faSave,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import { ReadingGoalFrequency } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import SettingsReadingGoalsMerge from '$lib/components/settings/settings-reading-goals-merge.svelte';
  import SettingsSyncDialog from '$lib/components/settings/settings-sync-dialog.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import type {
    BooksDbReadingGoal,
    BooksDbStorageSource
  } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager, type SyncSelection } from '$lib/data/dialog-manager';
  import {
    getCurrentReadingGoal,
    getDateRangeLabel,
    type ReadingGoal,
    type ReadingGoalSaveResult
  } from '$lib/data/reading-goal';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import {
    cacheStorageData$,
    database,
    isOnline$,
    readingGoal$,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    startDayHoursForTracker$,
    statisticsMergeMode$
  } from '$lib/data/store';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { isOnlineSourceAvailable } from '$lib/functions/utils';
  import { getDateKey, secondsToMinutes } from '$lib/functions/statistic-util';
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let storageSources: BooksDbStorageSource[] = [];

  const dispatch = createEventDispatcher<{
    spinner: boolean;
  }>();

  $: readingGoalFrequencies = [
    { id: ReadingGoalFrequency.DAILY, label: $t$('prefs.goals.daily') },
    { id: ReadingGoalFrequency.WEEKLY, label: $t$('prefs.goals.weekly') },
    { id: ReadingGoalFrequency.MONTHLY, label: $t$('prefs.goals.monthly') }
  ];

  let currentTimeGoal = 0;
  let currentCharacterGoal = 0;
  let currentReadingGoalFrequency = ReadingGoalFrequency.DAILY;
  let currentReadingGoalStartDate = '';
  let isInEditMode = false;
  let readingGoals: BooksDbReadingGoal[] = [];
  let sortedReadingGoals: BooksDbReadingGoal[] = [];
  let historyIndex = 0;
  const itemsPerPage = 1;

  $: availableSources = storageSources.filter((source) =>
    isOnlineSourceAvailable($isOnline$, source.type)
  );

  $: saveDisabled = !!((currentTimeGoal || currentCharacterGoal) && !currentReadingGoalStartDate);

  $: currentTimeGoalInMin = secondsToMinutes(currentTimeGoal);

  $: currentHistoryIndex = Math.max(0, historyIndex * itemsPerPage);

  $: historyReadingGoals = sortedReadingGoals.slice(
    currentHistoryIndex,
    currentHistoryIndex + itemsPerPage
  );

  $: hasNextHistoryPage = sortedReadingGoals.length > currentHistoryIndex + itemsPerPage;

  $: if ($readingGoal$) {
    ({
      timeGoal: currentTimeGoal,
      characterGoal: currentCharacterGoal,
      goalFrequency: currentReadingGoalFrequency,
      goalStartDate: currentReadingGoalStartDate
    } = $readingGoal$);
  }

  onMount(init);

  function handleReadingGoalChange(event: Event, isTimeGoal: boolean) {
    const { value } = event.target as HTMLInputElement;

    const mod = isTimeGoal ? 60 : 1;
    const val = Math.floor((Number.parseFloat(value) || 0) * mod);

    if (isTimeGoal) {
      currentTimeGoal = val < 0 ? 0 : val;
    } else {
      currentCharacterGoal = val < 0 ? 0 : val;
    }
  }

  async function saveReadingGoal() {
    if (!currentTimeGoal && !currentCharacterGoal) {
      currentReadingGoalStartDate = '';
      currentReadingGoalFrequency = ReadingGoalFrequency.DAILY;
    }

    if (
      currentTimeGoal === $readingGoal$.timeGoal &&
      currentCharacterGoal === $readingGoal$.characterGoal &&
      currentReadingGoalFrequency === $readingGoal$.goalFrequency &&
      currentReadingGoalStartDate === $readingGoal$.goalStartDate
    ) {
      isInEditMode = false;
      return;
    }

    try {
      const todayKey = getDateKey($startDayHoursForTracker$);
      const initialExistingReadingGoals = await database.getReadingGoalsForDateWindow(
        currentReadingGoalStartDate < $readingGoal$.goalStartDate
          ? currentReadingGoalStartDate || $readingGoal$.goalStartDate
          : $readingGoal$.goalStartDate || currentReadingGoalStartDate
      );
      const existingReadingGoals = currentReadingGoalStartDate
        ? initialExistingReadingGoals.filter(
            (item) => item.goalStartDate !== $readingGoal$.goalStartDate
          )
        : [];
      const isFutureWithoutReadingGoalConflicts =
        $readingGoal$.goalStartDate &&
        todayKey < $readingGoal$.goalStartDate &&
        !existingReadingGoals.length;

      const newReadingGoal = {
        timeGoal: currentTimeGoal,
        characterGoal: currentCharacterGoal,
        goalFrequency: currentReadingGoalFrequency,
        goalStartDate: currentReadingGoalStartDate,
        lastGoalModified: Date.now()
      };
      let readingGoalsToDelete: string[] = [];
      let readingGoalsToInsert: BooksDbReadingGoal[] = [];
      let error = '';

      if (isFutureWithoutReadingGoalConflicts && currentReadingGoalStartDate) {
        readingGoalsToDelete.push($readingGoal$.goalStartDate);
        readingGoalsToInsert.push({ ...newReadingGoal, goalEndDate: '', goalOriginalEndDate: '' });
      } else if (isFutureWithoutReadingGoalConflicts) {
        readingGoalsToDelete.push($readingGoal$.goalStartDate);
      } else if (initialExistingReadingGoals.length) {
        ({ readingGoalsToDelete, readingGoalsToInsert, error } =
          await new Promise<ReadingGoalSaveResult>((resolver) => {
            dialogManager.dialogs$.next([
              {
                component: SettingsReadingGoalsMerge,
                props: { newReadingGoal, resolver },
                disableCloseOnClick: true
              }
            ]);
          }));
      } else {
        readingGoalsToInsert.push({ ...newReadingGoal, goalEndDate: '', goalOriginalEndDate: '' });
      }

      if (error) {
        throw new Error(error);
      }

      dispatch('spinner', true);

      await database.updateReadingGoals(readingGoalsToDelete, readingGoalsToInsert);
    } catch (error: any) {
      tick().then(() =>
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: 'Error',
              message: `Error updating Reading Goal(s): ${error.message}`
            }
          }
        ])
      );
    } finally {
      dispatch('spinner', false);
      isInEditMode = false;
      await updateReadingGoalsData().catch(() => {
        // no-op
      });
    }
  }

  async function syncReadingGoals() {
    const [source, target] = await new Promise<SyncSelection[]>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: SettingsSyncDialog,
          props: {
            settingsSyncHeader: 'Sync Reading Goals',
            storageSources: availableSources,
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (!source || !target) {
      return;
    }

    dispatch('spinner', true);

    try {
      const error = await replicateData(
        getStorageHandler(
          window,
          source.type,
          source.id,
          target.type === StorageKey.BROWSER,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        ),
        getStorageHandler(
          window,
          target.type,
          target.id,
          target.type === StorageKey.BROWSER,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        ),
        false,
        [],
        [StorageDataType.READING_GOALS]
      );

      if (error) {
        throw new Error(error);
      }

      await updateReadingGoalsData();
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `Error syncing Reading Goals: ${message}`
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function deleteReadingGoals(readingGoalToDelete?: ReadingGoal, dateRangeLabel?: string) {
    let dialogMessage = '';

    if (readingGoalToDelete) {
      const isCurrentReadingGoal =
        $readingGoal$.goalStartDate &&
        $readingGoal$.goalStartDate === readingGoalToDelete.goalStartDate;
      const term =
        getDateKey($startDayHoursForTracker$) >= readingGoalToDelete.goalStartDate
          ? 'started'
          : 'starting';
      dialogMessage = `The${
        isCurrentReadingGoal ? ` current Reading Goal ${term} on` : ' archived Reading Goal for '
      } ${dateRangeLabel} will be deleted${isCurrentReadingGoal ? ' without archiving' : ''}`;
    } else if (readingGoals.length > 1) {
      dialogMessage = `All archived Reading Goals will be deleted${
        $readingGoal$.goalStartDate ? ' (including the current One)' : ''
      }`;
    } else {
      dialogMessage = $readingGoal$.goalStartDate
        ? 'Your current Reading Goal will be deleted without archiving'
        : 'Your archived Reading Goal will be deleted';
    }

    dialogMessage +=
      '\n\nExecute an one time Sync with an export behavior of "overwrite" and/or reading goals merge mode of "replace" to apply deletions to other devices';

    const wasCanceled = await new Promise((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: 'Data Deletion',
            dialogMessage,
            contentStyles: 'white-space: pre-line;',
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (wasCanceled) {
      return;
    }

    dispatch('spinner', true);

    try {
      await database.deleteReadingGoal(readingGoalToDelete?.goalStartDate);
      await updateReadingGoalsData();
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `An Error occurred: ${message}`
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function init() {
    try {
      dispatch('spinner', true);
      await updateReadingGoalsData();
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `Error loading Reading Goals: ${error.message}`
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function updateReadingGoalsData() {
    readingGoals = await database.getReadingGoals();

    sortedReadingGoals = [...readingGoals];
    sortedReadingGoals.sort((a, b) => (a.goalStartDate > b.goalStartDate ? -1 : 1));
    historyIndex = 0;

    $readingGoal$ = await getCurrentReadingGoal(readingGoals);
  }
</script>

<div class="mb-8 sm:col-span-2 lg:col-span-3">
  <div class="flex flex-grow">
    <h1 class="mb-2 text-xl font-medium w-full">
      <span class="capitalize">{$t$('prefs.goals')}</span>
    </h1>
    {#if isInEditMode}
      <button class={`${buttonClasses} mr-4`} disabled={saveDisabled} on:click={saveReadingGoal}>
        <div
          class="flex items-center justify-center hover:opacity-50"
          class:cursor-not-allowed={saveDisabled}
        >
          <span class="mr-2">{$t$('prefs.save')}</span>
          <Fa icon={faSave} />
        </div>
      </button>
      <button
        class={buttonClasses}
        on:click={() => {
          ({
            timeGoal: currentTimeGoal,
            characterGoal: currentCharacterGoal,
            goalFrequency: currentReadingGoalFrequency,
            goalStartDate: currentReadingGoalStartDate
          } = $readingGoal$);

          isInEditMode = false;
        }}
      >
        <div class="flex items-center justify-center hover:opacity-50">
          <span class="mr-2">{$t$('prefs.cancel')}</span>
          <Fa icon={faCancel} />
        </div>
      </button>
    {:else}
      <button class={buttonClasses} on:click={syncReadingGoals}>
        <div class="flex items-center justify-center hover:opacity-50">
          <span class="mr-2">{$t$('prefs.sync')}</span>
          <Fa icon={faRotate} />
        </div>
      </button>
      <button class={buttonClasses} on:click={() => (isInEditMode = true)}>
        <div class="flex items-center justify-center hover:opacity-50">
          <span class="mr-2">{$t$('prefs.edit')}</span>
          <Fa icon={faEdit} />
        </div>
      </button>
      <button
        class={buttonClasses}
        disabled={!readingGoals.length}
        on:click={() => deleteReadingGoals()}
      >
        <div
          title={$t$('prefs.goals.deleteAll')}
          class="flex items-center justify-center hover:opacity-50"
          class:cursor-not-allowed={!readingGoals.length}
        >
          <span class="mr-2">{$t$('prefs.reset')}</span>
          <Fa icon={faTrash} />
        </div>
      </button>
    {/if}
  </div>
  <hr class="border border-[color:var(--border-color)]" />
  <div class="grid grid-cols-1 gap-4 justify-between items-end mt-4 md:grid-cols-4">
    <div class="flex flex-col">
      {$t$('prefs.goals.time')}
      <input
        type="number"
        min="0"
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentTimeGoalInMin}
        on:blur={(event) => handleReadingGoalChange(event, true)}
      />
    </div>
    <div class="flex flex-col">
      {$t$('prefs.goals.characters')}
      <input
        type="number"
        min="0"
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentCharacterGoal}
        on:blur={(event) => handleReadingGoalChange(event, false)}
      />
    </div>
    <div class="flex flex-col">
      {$t$('prefs.goals.frequency')}
      <select
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentReadingGoalFrequency}
      >
        {#each readingGoalFrequencies as readingGoalFrequency (readingGoalFrequency.id)}
          <option value={readingGoalFrequency.id}>
            {readingGoalFrequency.label}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col">
      {$t$('prefs.goals.startDate')}
      <input
        type="date"
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentReadingGoalStartDate}
      />
    </div>
  </div>
  <details class="mt-6 cursor-pointer">
    <summary>
      {$t$(readingGoals.length === 1 ? 'prefs.goals.historyOne' : 'prefs.goals.history', {
        count: readingGoals.length
      })}
    </summary>
    {#if readingGoals.length}
      <div class="grid-cols-[repeat(4,1fr)_0.1fr] hidden sm:grid">
        {#each historyReadingGoals as historyGoal (historyGoal.goalStartDate)}
          {@const dateRangeLabel = getDateRangeLabel(
            historyGoal.goalStartDate,
            historyGoal.goalEndDate
          )}
          <div>{dateRangeLabel}</div>
          <div>{$t$('prefs.goals.minutes', { minutes: secondsToMinutes(historyGoal.timeGoal) })}</div>
          <div>{$t$('prefs.goals.chars', { count: historyGoal.characterGoal })}</div>
          <div>{historyGoal.goalFrequency}</div>
          <button
            on:click={() => deleteReadingGoals(historyGoal, dateRangeLabel)}
            title={$t$('prefs.goals.deleteOne')}
          >
            <Fa icon={faTrash} />
          </button>
        {/each}
      </div>
      <div class="sm:hidden">
        {#each historyReadingGoals as historyGoal (historyGoal.goalStartDate)}
          {@const dateRangeLabel = getDateRangeLabel(
            historyGoal.goalStartDate,
            historyGoal.goalEndDate
          )}
          <div class="my-2">
            {dateRangeLabel} / {$t$('prefs.goals.minutes', {
              minutes: secondsToMinutes(historyGoal.timeGoal)
            })} / {$t$('prefs.goals.chars', { count: historyGoal.characterGoal })} / {historyGoal.goalFrequency}
            <button
              on:click={() => deleteReadingGoals(historyGoal, dateRangeLabel)}
              title={$t$('prefs.goals.deleteOne')}
            >
              <Fa icon={faTrash} />
            </button>
          </div>
        {/each}
      </div>
      <div class="mt-3 flex justify-between">
        <button
          title={currentHistoryIndex === 0 ? '' : $t$('prefs.previousPage')}
          disabled={currentHistoryIndex === 0}
          class:opacity-50={currentHistoryIndex === 0}
          class:cursor-not-allowed={currentHistoryIndex === 0}
          on:click={() => (historyIndex -= 1)}
        >
          <Fa icon={faChevronLeft} />
        </button>
        <button
          title={hasNextHistoryPage ? $t$('prefs.nextPage') : ''}
          disabled={!hasNextHistoryPage}
          class:opacity-50={!hasNextHistoryPage}
          class:cursor-not-allowed={!hasNextHistoryPage}
          on:click={() => (historyIndex += 1)}
        >
          <Fa icon={faChevronRight} />
        </button>
      </div>
    {:else}
      <div>{$t$('prefs.goals.noHistory')}</div>
    {/if}
  </details>
</div>
