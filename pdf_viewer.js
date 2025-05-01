    // --- Global Variables ---
    let allPatientData = {}; // Stores all parsed data { patientId: [records] }
    let uniquePatientIds = []; // Sorted list of unique patient IDs
    let selectedPatientId = null; // Currently selected patient ID
    let currentViewMode = 'scatter'; // 'scatter' or 'bar'
    let latestInjuredSide = null; // 'Left' or 'Right', based on the latest record for the selected patient
    let testDateVisibility = {}; // { patientId: { dateStr: boolean } }

    const localStorageKey = 'analysisAppData'; // Key for saving/loading data

    // --- Constants ---
    const LEFT_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--left-line-color').trim() || '#1f77b4';
    const RIGHT_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--right-line-color').trim() || '#ff7f0e';
    const LEFT_BAR_COLOR_RGBA = getComputedStyle(document.documentElement).getPropertyValue('--left-bar-color-rgba').trim() || 'rgba(31, 119, 180, 0.8)';
    const RIGHT_BAR_COLOR_RGBA = getComputedStyle(document.documentElement).getPropertyValue('--right-bar-color-rgba').trim() || 'rgba(255, 127, 14, 0.8)';

    // Normative thresholds (example, replace with actual values if needed)
    const NORMATIVE_THRESHOLDS = {
        'I': {'poor_max': 1.47, 'average_mid': 1.65, 'good_min': 1.85, 'excellent_min': 2.1},
        'Y': {'poor_max': 1.25, 'average_mid': 1.4,  'good_min': 1.6,  'excellent_min': 1.76},
        'T': {'poor_max': 1.15, 'average_mid': 1.25, 'good_min': 1.4,  'excellent_min': 1.58}
    };
    const NORM_ZONE_COLORS = {
        poor: getComputedStyle(document.documentElement).getPropertyValue('--norm-poor-bg').trim() || 'rgba(252, 165, 165, 0.5)',
        average: getComputedStyle(document.documentElement).getPropertyValue('--norm-average-bg').trim() || 'rgba(252, 211, 77, 0.5)',
        good: getComputedStyle(document.documentElement).getPropertyValue('--norm-good-bg').trim() || 'rgba(167, 243, 208, 0.5)',
        excellent: getComputedStyle(document.documentElement).getPropertyValue('--norm-excellent-bg').trim() || 'rgba(52, 211, 153, 0.5)'
    };
    const POSITIONS = ['I', 'Y', 'T']; // Test positions
    const METRIC_KEYS = { MAX_FORCE: 'Max Force (N)', RFD: 'RFD 100ms (N/s)', NORM: 'Max Force / BW' };
    const METRICS_DISPLAY_ORDER = [METRIC_KEYS.MAX_FORCE, METRIC_KEYS.RFD, METRIC_KEYS.NORM]; // Order for summary table

    // --- DOM Element References ---
    const uploadInputHidden = document.getElementById('upload-csv-hidden');
    const fileInfo = document.getElementById('file-info');
    const patientSearchInput = document.getElementById('patient-search');
    const patientButtonContainer = document.getElementById('patient-button-container');
    const outputArea = document.getElementById('output-area');
    const loadingSpinner = document.getElementById('loading-spinner');
    const errorMessage = document.getElementById('error-message');
    const backButtonLink = document.getElementById('back-to-screening-link');
    const clearFilesButton = document.getElementById('clear-files-btn'); // Updated ID
    // const toggleDatesContainer = document.getElementById('toggle-dates-container'); // No longer needed here, created dynamically
    const demographicInfoArea = document.getElementById('demographic-info-area');
    const uploadBox = document.getElementById('upload-box');
    const pdfPreviewButton = document.getElementById('pdf-preview-button'); // PDF Button
    const pdfModal = document.getElementById('pdf-modal'); // PDF Modal
    const pdfGraphsBtn = document.getElementById('pdf-graphs-btn'); // Modal Graph Button
    const pdfTableBtn = document.getElementById('pdf-table-btn'); // Modal Table Button
    const mainContentArea = document.getElementById('main-content-area'); // Main content wrapper
    const graphReportView = document.getElementById('graph-report-view');
    const graphReportContent = document.getElementById('graph-report-content');
    const tableReportView = document.getElementById('table-report-view');
    const tableReportContent = document.getElementById('table-report-content');


    let viewScatterBtn = null; // Will be assigned after rendering
    let viewBarBtn = null; // Will be assigned after rendering

    // --- Plotly Configuration ---
    const plotlyConfig = {
        displaylogo: false,
        modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d', 'hoverClosestCartesian', 'hoverCompareCartesian'],
        modeBarButtonsToAdd: [{
            name: 'Download plot as PNG',
            icon: Plotly.Icons.camera,
            click: function(gd) {
                const titleText = (gd.layout.title?.text || 'plot').replace(/<br>/g, ' ');
                Plotly.downloadImage(gd, { format: 'png', width: gd._fullLayout.width, height: gd._fullLayout.height, filename: titleText });
            }
        }]
    };

    // --- Local Storage Functions ---
    function saveAnalysisStateToLocalStorage() {
        const stateToSave = {
            allPatientData: {}, // Will be populated with ISO dates
            uniquePatientIds: uniquePatientIds,
            selectedPatientId: selectedPatientId,
            currentViewMode: currentViewMode,
            testDateVisibility: testDateVisibility // Save visibility state
        };
        try {
            // Deep copy and convert Date objects to ISO strings for storage
            const dataWithIsoDates = JSON.parse(JSON.stringify(allPatientData));
            for (const pid in dataWithIsoDates) {
                if (Array.isArray(dataWithIsoDates[pid])) {
                    dataWithIsoDates[pid].forEach(record => {
                        // Check if 'Test Date' exists and has toISOString method
                        if (record['Test Date'] && typeof record['Test Date'].toISOString === 'function') {
                            try {
                                record['Test Date'] = record['Test Date'].toISOString();
                            } catch (e) {
                                console.warn("Could not convert date to ISO string during save:", record['Test Date'], e);
                                // Handle cases where it might be an invalid date object after parsing/manipulation
                                record['Test Date'] = null;
                            }
                        } else if (record['Test Date']) {
                             // If it exists but isn't a valid Date object (e.g., already a string or null)
                             // Attempt to parse and re-stringify, or set to null if invalid
                             const parsedDate = new Date(record['Test Date']);
                             if (!isNaN(parsedDate)) {
                                 record['Test Date'] = parsedDate.toISOString();
                             } else {
                                 console.warn("Invalid date value encountered during save:", record['Test Date']);
                                 record['Test Date'] = null;
                             }
                        } else {
                            record['Test Date'] = null; // Ensure null if it doesn't exist
                        }
                    });
                     // Filter out records with null dates after conversion attempt
                    dataWithIsoDates[pid] = dataWithIsoDates[pid].filter(r => r['Test Date'] !== null);
                }
            }
            stateToSave.allPatientData = dataWithIsoDates;
            localStorage.setItem(localStorageKey, JSON.stringify(stateToSave));
            // console.log("Analysis state saved."); // Optional: for debugging
        } catch (error) {
            console.error('Error saving analysis state to localStorage:', error);
            errorMessage.textContent = 'Could not save analysis state. Storage might be full.';
        }
    }


    function loadAnalysisStateFromLocalStorage() {
        try {
            const savedDataString = localStorage.getItem(localStorageKey);
            if (savedDataString) {
                const savedState = JSON.parse(savedDataString);
                console.log('Loading analysis state from localStorage.');

                allPatientData = savedState.allPatientData || {};
                uniquePatientIds = savedState.uniquePatientIds || [];
                selectedPatientId = savedState.selectedPatientId || null;
                currentViewMode = savedState.currentViewMode || 'scatter';
                testDateVisibility = savedState.testDateVisibility || {}; // Load visibility state

                // Convert ISO date strings back to Date objects
                for (const pid in allPatientData) {
                    if (Array.isArray(allPatientData[pid])) {
                        allPatientData[pid].forEach(record => {
                            if (record['Test Date'] && typeof record['Test Date'] === 'string') {
                                const parsedDate = new Date(record['Test Date']);
                                record['Test Date'] = !isNaN(parsedDate) ? parsedDate : null;
                                if (isNaN(parsedDate)) console.warn("Failed to parse date string:", record['Test Date']);
                            } else if (!(record['Test Date'] instanceof Date)) {
                                record['Test Date'] = null; // Ensure it's a Date object or null
                            }
                        });
                        // Filter out any records where date conversion failed and sort
                        allPatientData[pid] = allPatientData[pid].filter(r => r['Test Date'] instanceof Date);
                        allPatientData[pid].sort((a, b) => a['Test Date'] - b['Test Date']);
                    }
                }

                fileInfo.textContent = `${Object.keys(allPatientData).length} patient(s) loaded from saved data. Add more files or select a patient.`;
                displayPatientButtons();

                // If a patient was previously selected, display their data
                if (selectedPatientId && allPatientData[selectedPatientId]) {
                    console.log("Triggering display for loaded patient:", selectedPatientId);
                    selectPatient(selectedPatientId, true); // Pass true to indicate it's loading
                } else {
                    console.log("No patient selected or patient data missing after load.");
                    // Clear dynamic areas if no patient is loaded
                    const toggleDatesContainer = document.getElementById('toggle-dates-container');
                    if(toggleDatesContainer) toggleDatesContainer.innerHTML = '';
                    demographicInfoArea.innerHTML = '';
                    outputArea.innerHTML = '';
                }

            } else {
                console.log('No analysis data found in localStorage.');
                fileInfo.textContent = 'Select patient data files or drag and drop here to begin.';
                displayPatientButtons();
            }
        } catch (error) {
            console.error('Error loading analysis state from localStorage:', error);
            errorMessage.textContent = 'Could not load previous analysis state.';
            // Reset state on error
            allPatientData = {}; uniquePatientIds = []; selectedPatientId = null;
            currentViewMode = 'scatter'; testDateVisibility = {};
            displayPatientButtons();
             const toggleDatesContainer = document.getElementById('toggle-dates-container');
             if(toggleDatesContainer) toggleDatesContainer.innerHTML = '';
            demographicInfoArea.innerHTML = ''; outputArea.innerHTML = '';
        }
    }

    function clearAnalysisHistory() {
        if (confirm('Are you sure you want to clear all saved analysis data? This cannot be undone.')) {
            try {
                localStorage.removeItem(localStorageKey);
                // Reset all global state variables
                allPatientData = {}; uniquePatientIds = []; selectedPatientId = null;
                latestInjuredSide = null; currentViewMode = 'scatter'; testDateVisibility = {};
                // Clear UI elements
                outputArea.innerHTML = '';
                 const toggleDatesContainer = document.getElementById('toggle-dates-container'); // Find it if it exists
                 if(toggleDatesContainer) toggleDatesContainer.innerHTML = ''; // Clear it
                demographicInfoArea.innerHTML = '';
                fileInfo.textContent = 'Select patient data files or drag and drop here to begin.';
                patientSearchInput.value = '';
                displayPatientButtons(); // Update patient list (will show empty message)
                console.log('Analysis history cleared.');
                errorMessage.textContent = '';
            } catch (error) {
                console.error('Error clearing analysis history:', error);
                errorMessage.textContent = 'Could not clear saved data.';
            }
        }
    }

    // --- Event Listeners ---
    uploadInputHidden.addEventListener('change', (event) => handleFileUpload(event.target.files));
    patientSearchInput.addEventListener('input', displayPatientButtons);

    if (backButtonLink) {
        backButtonLink.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Back button clicked, saving state before navigation.');
            saveAnalysisStateToLocalStorage(); // Save state before leaving
            window.location.href = '../screening.html'; // Navigate
        });
    }
    if (clearFilesButton) { // Updated event listener target
        clearFilesButton.addEventListener('click', clearAnalysisHistory);
    }
    if (uploadBox) {
        uploadBox.addEventListener('dragover', (event) => { event.preventDefault(); uploadBox.classList.add('dragover'); });
        uploadBox.addEventListener('dragleave', () => { uploadBox.classList.remove('dragover'); });
        uploadBox.addEventListener('drop', (event) => {
            event.preventDefault(); uploadBox.classList.remove('dragover');
            const files = event.dataTransfer.files;
            if (files.length > 0) handleFileUpload(files);
        });
        // Prevent button click from triggering this if button is inside uploadBox
        uploadBox.addEventListener('click', (event) => {
            // Only trigger if the click target is the box itself, not the button inside
            if (event.target === uploadBox || event.target.closest('.upload-icon') || event.target.tagName === 'P') {
                 uploadInputHidden.click();
            }
        });
    }
    // PDF Modal Listeners
    if (pdfPreviewButton) {
        pdfPreviewButton.addEventListener('click', () => {
            if (selectedPatientId && allPatientData[selectedPatientId]) {
                 pdfModal.style.display = 'flex';
            } else {
                 alert("Please select a patient first.");
            }
        });
    }
    if (pdfGraphsBtn) {
        pdfGraphsBtn.addEventListener('click', showGraphReport);
    }
    if (pdfTableBtn) {
        pdfTableBtn.addEventListener('click', showTableReport);
    }


    // --- UI Update Functions ---

    function switchViewMode(mode) {
        if (mode === currentViewMode) return; // No change needed

        currentViewMode = mode;
        // Update button styles (check if buttons exist first)
        // Note: Buttons are re-created in displayPatientDataAndGraphs,
        // so direct class toggling here might not be necessary if displayPatientDataAndGraphs is always called after.
        // However, keeping it provides immediate visual feedback if needed elsewhere.
        viewScatterBtn = document.getElementById('view-scatter-btn'); // Re-select in case DOM changed
        viewBarBtn = document.getElementById('view-bar-btn');
        if (viewScatterBtn && viewBarBtn) {
            viewScatterBtn.classList.toggle('active', mode === 'scatter');
            viewBarBtn.classList.toggle('active', mode === 'bar');
        }


        // Re-render the output area if a patient is selected
        if (selectedPatientId) {
            displayPatientDataAndGraphs(selectedPatientId);
        } else {
            outputArea.innerHTML = ''; // Clear output if no patient selected
        }
        console.log("Switched view to:", currentViewMode);
        saveAnalysisStateToLocalStorage(); // Save the new view mode
    }

    function handleFileUpload(files) {
        if (!files || files.length === 0) { fileInfo.textContent = 'No files selected.'; return; }

        errorMessage.textContent = ''; loadingSpinner.style.display = 'flex';
        fileInfo.textContent = `Loading ${files.length} new file(s)...`;
        let filesProcessed = 0, skippedFileCount = 0;
        const promises = [];
        let newPatientData = {}; // Temporarily store data from newly uploaded files

        for (const file of files) {
            // Validate filename format (e.g., ASH_PatientID_YYYY-MM-DD.csv)
            const match = file.name.match(/ASH_([^_]+)_(\d{4}-\d{2}-\d{2})\.csv/i);
            if (!match || !match[1] || !match[2]) {
                console.warn(`Filename format error, skipping: ${file.name}`);
                filesProcessed++; skippedFileCount++; continue;
            }

            const patientId = match[1];
            const dateStringFromFile = match[2];
            const testDateFromFile = new Date(dateStringFromFile + 'T00:00:00'); // Use T00:00:00 for consistency

            if (isNaN(testDateFromFile)) {
                console.warn(`Invalid date in filename, skipping: ${file.name}`);
                filesProcessed++; skippedFileCount++; continue;
            }

            // Check for duplicates based on patient ID and filename date *before* parsing
            let isDuplicateDate = false;
            if (allPatientData[patientId]) {
                isDuplicateDate = allPatientData[patientId].some(record =>
                    record['Test Date'] instanceof Date && !isNaN(record['Test Date']) &&
                    record['Test Date'].toISOString().split('T')[0] === dateStringFromFile
                );
            }
            if (isDuplicateDate) {
                console.log(`Skipping duplicate file based on filename date: ${file.name}`);
                filesProcessed++; skippedFileCount++;
                promises.push(Promise.resolve({ skipped: true, filename: file.name })); // Resolve promise for skipped file
                continue;
            }

            // Parse the CSV file
            promises.push(new Promise((resolve, reject) => {
                Papa.parse(file, {
                    header: true, skipEmptyLines: true, dynamicTyping: true,
                    complete: (results) => {
                        try {
                            if (!newPatientData[patientId]) newPatientData[patientId] = [];
                            results.data.forEach(row => {
                                if (row && typeof row === 'object' && row['Metric'] && row['Position']) {
                                    let positionClean = String(row['Position']).replace(/ASH Test Position\s+/i, '').trim();
                                    if (POSITIONS.includes(positionClean)) {
                                        // Ensure numeric conversion, handle null/NaN
                                        const leftVal = row['Left Value'] == null || isNaN(Number(row['Left Value'])) ? null : Number(row['Left Value']);
                                        const rightVal = row['Right Value'] == null || isNaN(Number(row['Right Value'])) ? null : Number(row['Right Value']);
                                        const bwVal = row['Bodyweight (kg)'] == null || isNaN(Number(row['Bodyweight (kg)'])) ? null : Number(row['Bodyweight (kg)']);

                                        newPatientData[patientId].push({
                                            ...row, // Keep original data
                                            'Left Value': leftVal,
                                            'Right Value': rightVal,
                                            'Bodyweight (kg)': bwVal,
                                            'Test Date': testDateFromFile, // Use date parsed from filename
                                            'Filename': file.name,
                                            'Position Clean': positionClean
                                        });
                                    } else { console.warn(`Invalid position '${row['Position']}' in ${file.name}.`); }
                                } else { console.warn(`Invalid row structure in ${file.name}.`, row); }
                            });
                        } catch (parseError) {
                            console.error(`Error processing row data in ${file.name}:`, parseError);
                            reject(`Error processing data in ${file.name}`); return;
                        }
                        filesProcessed++; resolve({ skipped: false }); // Indicate success
                    },
                    error: (error) => { filesProcessed++; reject(`Parsing error in ${file.name}: ${error.message}`); }
                });
            }));
        }

        // Process results after all files are parsed (or skipped)
        Promise.allSettled(promises).then(results => {
            loadingSpinner.style.display = 'none';
            let filesAddedCount = 0;
            let patientsAddedCount = 0;

            // Merge new data into the main data store
            for (const patientId in newPatientData) {
                if (!allPatientData[patientId]) { // New patient
                    allPatientData[patientId] = newPatientData[patientId];
                    patientsAddedCount++;
                    filesAddedCount++;
                } else { // Existing patient, add new records
                    allPatientData[patientId].push(...newPatientData[patientId]);
                    // Sort records by date after adding new ones
                    allPatientData[patientId].sort((a, b) => a['Test Date'] - b['Test Date']);
                    filesAddedCount++;
                }
                // Initialize visibility for newly added dates for this patient
                initializeVisibility(patientId);
            }

            // Update the list of unique patient IDs and sort
            uniquePatientIds = Object.keys(allPatientData).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
            displayPatientButtons(); // Refresh the patient button list
            saveAnalysisStateToLocalStorage(); // Save the updated data

            // Update file info message
            const finalPatientCount = uniquePatientIds.length;
            let infoMsg = `${finalPatientCount} total patient(s). `;
            infoMsg += `Processed ${files.length} file(s). `;
            if (filesAddedCount > 0) {
                infoMsg += `Added data for ${patientsAddedCount} new patient(s) and updated ${filesAddedCount - patientsAddedCount} existing patient(s). `;
            }
            if (skippedFileCount > 0) {
                infoMsg += `Skipped ${skippedFileCount} file(s) due to format errors or duplicate dates based on filename. `;
            }
            fileInfo.textContent = infoMsg + 'Select a patient below.';

            // Display errors from parsing, if any
            const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
            if (errors.length > 0) errorMessage.textContent = `Some files could not be processed: ${errors.join('; ')}`;

            // If the currently selected patient was updated, refresh their view
            if (selectedPatientId && newPatientData[selectedPatientId]) {
                // renderTestDateList(selectedPatientId); // Update date toggles first - Now done inside displayPatientDataAndGraphs
                displayPatientDataAndGraphs(selectedPatientId); // Then update graphs/table
            } else if (selectedPatientId) {
                // renderTestDateList(selectedPatientId); // Still update date list if patient exists but wasn't in upload - Now done inside displayPatientDataAndGraphs
                 displayPatientDataAndGraphs(selectedPatientId); // Refresh view even if no new data for this patient
            }

             // Clear the file input value after processing
             uploadInputHidden.value = null;

        }).catch(err => { // Catch unexpected errors during Promise.allSettled
            loadingSpinner.style.display = 'none';
            errorMessage.textContent = `An unexpected error occurred during file processing: ${err.message}`;
            console.error("Unexpected error handling file uploads:", err);
            displayPatientButtons(); // Ensure buttons are still displayed
             // Clear the file input value even on error
             uploadInputHidden.value = null;
        });
    }

    function displayPatientButtons() {
        const searchTerm = patientSearchInput.value.toLowerCase();
        patientButtonContainer.innerHTML = ''; // Clear existing buttons

        if (uniquePatientIds.length === 0) {
            if (loadingSpinner.style.display === 'none') { // Only show message if not loading
                if (!localStorage.getItem(localStorageKey)) { // No saved data at all
                    patientButtonContainer.innerHTML = '<span class="text-slate-500 italic self-center">Upload files or load saved data to see patients.</span>';
                } else { // Saved data exists but is empty
                    patientButtonContainer.innerHTML = '<span class="text-slate-500 italic self-center">No patients found in saved data or uploaded files.</span>';
                }
            }
            return;
        }

        const filteredIds = uniquePatientIds.filter(id => id.toLowerCase().includes(searchTerm));

        if (filteredIds.length === 0) {
            patientButtonContainer.innerHTML = '<span class="text-slate-500 italic self-center">No patients match search.</span>';
            return;
        }

        // Create buttons for filtered patients
        filteredIds.forEach(pid => {
            const button = document.createElement('button');
            button.textContent = pid;
            button.className = `patient-button`;
            if (pid === selectedPatientId) button.classList.add('selected'); // Highlight selected
            button.onclick = () => selectPatient(pid); // Add click handler
            patientButtonContainer.appendChild(button);
        });
    }

    function selectPatient(patientId, isLoading = false) {
        selectedPatientId = patientId;
        console.log(`Selected patient: ${patientId}`);

        displayPatientButtons(); // Update button highlighting
        initializeVisibility(patientId); // Ensure visibility state exists
        // renderTestDateList(patientId); // Show/hide date toggles - Now done inside displayPatientDataAndGraphs
        displayPatientDataAndGraphs(selectedPatientId); // Load graphs and table
        if (!isLoading) { // Only save if it's a user action, not initial load
             saveAnalysisStateToLocalStorage();
        }
    }

    function getUniqueTestDates(patientId) {
        if (!allPatientData[patientId]) return [];
        const dateSet = new Set();
        allPatientData[patientId].forEach(record => {
            if (record['Test Date'] instanceof Date && !isNaN(record['Test Date'])) {
                dateSet.add(record['Test Date'].toISOString().split('T')[0]); // Store as YYYY-MM-DD string
            }
        });
        return Array.from(dateSet).sort(); // Return sorted array of unique date strings
    }

    // Ensure visibility state is initialized for all known dates of a patient
    function initializeVisibility(patientId) {
        if (!testDateVisibility[patientId]) {
            testDateVisibility[patientId] = {};
        }
        const uniqueDates = getUniqueTestDates(patientId);
        uniqueDates.forEach(dateStr => {
            // If a date is not in the visibility map, default it to visible (true)
            if (testDateVisibility[patientId][dateStr] === undefined) {
                testDateVisibility[patientId][dateStr] = true;
            }
        });
    }

    function handleDateToggle(patientId, dateToToggle) {
        if (!testDateVisibility[patientId]) {
            console.error("Visibility state not initialized for patient:", patientId); return;
        }
        // Toggle the boolean value
        const currentVisibility = testDateVisibility[patientId][dateToToggle];
        testDateVisibility[patientId][dateToToggle] = !currentVisibility;
        console.log(`Toggled visibility for ${patientId} - ${dateToToggle} to ${!currentVisibility}`);

        // renderTestDateList(patientId); // Update the button appearance - Now done inside displayPatientDataAndGraphs
        displayPatientDataAndGraphs(selectedPatientId); // Re-render graphs/table with new visibility
        saveAnalysisStateToLocalStorage(); // Save the change
    }

    // Renders the list of toggle buttons for test dates INSIDE the output area
    function renderTestDateList(patientId, targetElement) {
        targetElement.innerHTML = ''; // Clear previous content of the target element
        const uniqueDates = getUniqueTestDates(patientId);

        // Only show the toggle section if there are multiple dates
        if (uniqueDates.length <= 1) {
            targetElement.style.display = 'none'; // Hide the container
            return;
        }

        targetElement.style.display = 'block'; // Show the container
        targetElement.className = 'section-box toggle-dates-section'; // Add class for styling
        targetElement.style.marginTop = '1rem'; // Add space above
        targetElement.style.marginBottom = '1.5rem'; // Add space below


        initializeVisibility(patientId); // Make sure state is up-to-date

        // Add title to the toggle box
        const title = document.createElement('h3');
        title.className = 'toggle-dates-title'; // Use existing style
        title.textContent = 'Toggle Test Dates';
        targetElement.appendChild(title);

        // Create container for the buttons
        const listContainer = document.createElement('div');
        listContainer.className = 'test-date-list';
        targetElement.appendChild(listContainer);

        // Create a button for each unique date
        uniqueDates.forEach(dateStr => {
            const isVisible = testDateVisibility[patientId]?.[dateStr] ?? true; // Default to true if undefined
            const button = document.createElement('button');
            button.className = `test-date-button ${isVisible ? 'visible' : 'hidden'}`;
            button.textContent = dateStr;
            button.dataset.date = dateStr; // Store date string for the handler

            // Add icon (check or times)
            const icon = document.createElement('i');
            icon.className = `icon fas ${isVisible ? 'fa-check-circle' : 'fa-times'}`;
            button.prepend(icon); // Add icon before text

            button.onclick = () => handleDateToggle(patientId, dateStr); // Set click handler

            listContainer.appendChild(button);
        });

        console.log("Rendered date list for", patientId);
    }


    // Filters and sorts data based on selected visibility
    function getProcessedPatientData(patientId) {
        const patientRecords = allPatientData[patientId];
        if (!patientRecords || patientRecords.length === 0) return null; // No data for patient

        initializeVisibility(patientId); // Ensure visibility state exists

        // Get the list of date strings that should be visible
        const visibleDateStrings = testDateVisibility[patientId]
            ? Object.keys(testDateVisibility[patientId]).filter(dateStr => testDateVisibility[patientId][dateStr])
            : getUniqueTestDates(patientId); // Fallback if state is missing (shouldn't happen)

        // Filter the records based on visible dates
        const visibleRecords = patientRecords.filter(record => {
            if (!(record['Test Date'] instanceof Date) || isNaN(record['Test Date'])) return false; // Skip invalid dates
            const dateStr = record['Test Date'].toISOString().split('T')[0];
            return visibleDateStrings.includes(dateStr); // Check if the record's date is in the visible list
        });

        if (visibleRecords.length === 0) {
            return []; // Return empty array if no visible dates selected
        }

        // Sort the visible records by date (should already be sorted, but good practice)
        visibleRecords.sort((a, b) => a['Test Date'] - b['Test Date']);

        // Calculate 'Weeks Since First' based *only* on the visible records
        const firstVisibleTestDate = visibleRecords[0]['Test Date'];
        if (!firstVisibleTestDate) {
            console.log("No valid first test date found in visible records.");
            return [];
        }

        const processedData = visibleRecords.map(record => {
            const weeksSinceFirst = Math.round((record['Test Date'] - firstVisibleTestDate) / (1000 * 60 * 60 * 24 * 7));
            return { ...record, 'Weeks Since First': weeksSinceFirst };
        });

        return processedData;
    }

    // Main function to display patient info, graphs, and table
    function displayPatientDataAndGraphs(patientId) {
        // Show loading state
        outputArea.innerHTML = '<div class="text-center p-10"><i class="fas fa-spinner fa-spin text-blue-600 text-3xl"></i><p class="mt-2">Loading data and graphs...</p></div>';
        demographicInfoArea.innerHTML = ''; // Clear old demo info

        try {
            const processedData = getProcessedPatientData(patientId); // Get data filtered by visibility

            if (!processedData) { // Should not happen if patient exists, but check anyway
                outputArea.innerHTML = `<p class="error-message text-center font-semibold">Could not find data for patient ${patientId}.</p>`;
                latestInjuredSide = null;
                // Ensure toggle dates container is hidden if it exists
                const toggleDatesContainer = document.getElementById('toggle-dates-container');
                if (toggleDatesContainer) toggleDatesContainer.style.display = 'none';
                return;
            }

            // --- Display Demographic Info ---
            let demoHTML = '';
            if (allPatientData[patientId] && allPatientData[patientId].length > 0) {
                const allRecordsForPatient = allPatientData[patientId]; // Use all records to find latest demo info
                latestInjuredSide = null; // Reset before finding latest
                let latestDemo = {};

                // Find the latest non-null value for each demographic field by iterating backwards
                for (let i = allRecordsForPatient.length - 1; i >= 0; i--) {
                    const record = allRecordsForPatient[i];
                    if (latestDemo['Age'] == null && record['Age'] != null) latestDemo['Age'] = record['Age'];
                    if (latestDemo['Gender'] == null && record['Gender'] != null) latestDemo['Gender'] = record['Gender'];
                    if (latestDemo['Sport'] == null && record['Sport'] != null) latestDemo['Sport'] = record['Sport'];
                    if (latestDemo['Bodyweight (kg)'] == null && record['Bodyweight (kg)'] != null) latestDemo['Bodyweight (kg)'] = record['Bodyweight (kg)'];
                    if (latestDemo['Injured Side'] == null && record['Injured Side'] != null) {
                        latestDemo['Injured Side'] = record['Injured Side'];
                        latestInjuredSide = record['Injured Side']; // Update global variable
                    }
                    // Stop if all fields found
                    if (latestDemo['Age'] != null && latestDemo['Gender'] != null && latestDemo['Sport'] != null && latestDemo['Bodyweight (kg)'] != null && latestDemo['Injured Side'] != null) break;
                }
                // Default injured side if not found (though it should be in the data)
                if (!latestInjuredSide) latestInjuredSide = 'Left';

                // Build HTML for demographic info
                demoHTML = `
                    <h3 class="demographic-title">Demographic Information</h3>
                    <div class="demographic-row">
                        <div><strong>Age:</strong>&nbsp;${latestDemo['Age'] ?? 'N/A'}</div>
                        <div><strong>Gender:</strong>&nbsp;${latestDemo['Gender'] ?? 'N/A'}</div>
                        <div><strong>Sport:</strong>&nbsp;${latestDemo['Sport'] ?? 'N/A'}</div>
                        <div><strong>Bodyweight (last):</strong>&nbsp;${latestDemo['Bodyweight (kg)'] != null ? latestDemo['Bodyweight (kg)'].toFixed(1) + ' kg' : 'N/A'}</div>
                        <div><strong>Injured Side (last):</strong>&nbsp;${latestInjuredSide ?? 'N/A'}</div>
                    </div>`;
                demographicInfoArea.innerHTML = demoHTML;
            } else {
                demographicInfoArea.innerHTML = ''; // Clear if no records found
            }

             // --- Render Header, Toggle Dates, Graphs and Table based on View Mode ---
             let resultsHTML = '';
             const dataGroupedByDate = groupDataByDate(processedData); // Group *after* filtering

             if (currentViewMode === 'scatter') {
                 resultsHTML = renderScatterView(dataGroupedByDate, patientId); // Pass patientId
             } else { // 'bar' mode
                 resultsHTML = renderBarChartView(dataGroupedByDate, patientId); // Pass patientId
             }

             outputArea.innerHTML = resultsHTML; // Set the HTML structure first


            // --- Check if there's data to display after filtering ---
            // This check needs to happen *before* trying to render graphs/tables
            if (processedData.length === 0) {
                 // Keep the header and toggle buttons, but show message instead of graphs/table
                 const graphArea = document.getElementById('graphs-and-summary-area'); // Find the area where graphs/summary would go
                 if (graphArea) {
                     graphArea.innerHTML = `<p class="text-center text-slate-500 italic mt-6">No test dates selected to display. Please select dates using the toggles above.</p>`;
                 }
                 // Ensure date toggles are rendered and visible (even if no data)
                 const toggleDatesTarget = document.getElementById('toggle-dates-container');
                 if (toggleDatesTarget) {
                     renderTestDateList(patientId, toggleDatesTarget);
                 } else {
                     console.error("Target element for date toggles not found after render.");
                 }
                 return; // Stop further processing
             }


            // --- Render Plotly Graphs (after HTML is in DOM) ---
            setTimeout(() => {
                try {
                    // Render the graphs based on the current view
                    if (currentViewMode === 'scatter') {
                        renderScatterPlots(dataGroupedByDate);
                    } else {
                        renderBarCharts(dataGroupedByDate, latestInjuredSide);
                    }

                    // Render the date toggles into their container
                    const toggleDatesTarget = document.getElementById('toggle-dates-container');
                    if (toggleDatesTarget) {
                        renderTestDateList(patientId, toggleDatesTarget);
                    } else {
                         console.error("Target element for date toggles not found after render.");
                    }


                    // Add event listeners to the view toggle buttons (re-select them)
                    viewScatterBtn = document.getElementById('view-scatter-btn');
                    viewBarBtn = document.getElementById('view-bar-btn');
                    if(viewScatterBtn) viewScatterBtn.addEventListener('click', () => switchViewMode('scatter'));
                    if(viewBarBtn) viewBarBtn.addEventListener('click', () => switchViewMode('bar'));

                } catch (plotError) {
                    console.error("Error rendering plots:", plotError);
                    // Attempt to add error message without overwriting header/toggles
                     const graphArea = document.getElementById('graphs-and-summary-area');
                     if(graphArea) {
                         graphArea.innerHTML += `<p class="error-message text-center mt-4">An error occurred while rendering the graphs.</p>`;
                     } else {
                         outputArea.innerHTML += `<p class="error-message text-center mt-4">An error occurred while rendering the graphs.</p>`;
                     }
                }
            }, 50); // Small delay

        } catch (error) {
            console.error("Error displaying patient data:", error);
            outputArea.innerHTML = `<p class="error-message text-center font-semibold">An error occurred while processing data for patient ${patientId}.</p>`;
             const toggleDatesContainer = document.getElementById('toggle-dates-container');
             if (toggleDatesContainer) toggleDatesContainer.style.display = 'none';
        }
    }

    // Groups processed records by date string (YYYY-MM-DD)
    function groupDataByDate(processedData) {
        const dataByDate = {};
        processedData.forEach(r => {
            if (!(r['Test Date'] instanceof Date) || isNaN(r['Test Date'])) {
                console.warn("Skipping record with invalid date during grouping:", r); return;
            }
            const dateStr = r['Test Date'].toISOString().split('T')[0];

            // Initialize entry for the date if it doesn't exist
            if (!dataByDate[dateStr]) {
                dataByDate[dateStr] = {
                    'Test Date': r['Test Date'],
                    'Weeks Since First': r['Weeks Since First'],
                    'Bodyweight (kg)': r['Bodyweight (kg)'], // Initialize BW
                    // Initialize positions and metrics
                    'I': { [METRIC_KEYS.MAX_FORCE]: { Left: null, Right: null }, [METRIC_KEYS.RFD]: { Left: null, Right: null }, [METRIC_KEYS.NORM]: { Left: null, Right: null } },
                    'Y': { [METRIC_KEYS.MAX_FORCE]: { Left: null, Right: null }, [METRIC_KEYS.RFD]: { Left: null, Right: null }, [METRIC_KEYS.NORM]: { Left: null, Right: null } },
                    'T': { [METRIC_KEYS.MAX_FORCE]: { Left: null, Right: null }, [METRIC_KEYS.RFD]: { Left: null, Right: null }, [METRIC_KEYS.NORM]: { Left: null, Right: null } }
                };
            }

            // Fill in metric data for the specific position and metric
            const pos = r['Position Clean'];
            const metric = r['Metric'];
            if (pos && dataByDate[dateStr][pos] && dataByDate[dateStr][pos][metric]) {
                // Use value from current record if available, otherwise keep existing (null)
                dataByDate[dateStr][pos][metric].Left = r['Left Value'] ?? dataByDate[dateStr][pos][metric].Left;
                dataByDate[dateStr][pos][metric].Right = r['Right Value'] ?? dataByDate[dateStr][pos][metric].Right;
            }

            // Update bodyweight if available in this record (take the last one found for the date)
            if(r['Bodyweight (kg)'] != null) dataByDate[dateStr]['Bodyweight (kg)'] = r['Bodyweight (kg)'];

            // Recalculate Normalized Force (N/kg) after potentially updating Max Force or BW
            for (const p of POSITIONS) {
                const bw = dataByDate[dateStr]['Bodyweight (kg)'];
                const mfData = dataByDate[dateStr][p]?.[METRIC_KEYS.MAX_FORCE]; // Max Force data for this position
                if (!mfData) continue; // Skip if Max Force data is missing

                let nKgL = null; let nKgR = null;
                if (bw != null && bw > 0) { // Calculate only if BW is valid
                    if (mfData.Left != null) nKgL = mfData.Left / bw;
                    if (mfData.Right != null) nKgR = mfData.Right / bw;
                }
                // Update the NORM metric data
                if(dataByDate[dateStr][p]) {
                    dataByDate[dateStr][p][METRIC_KEYS.NORM] = { Left: nKgL, Right: nKgR };
                }
            }
        });
        // Return array of date objects, sorted by date (already sorted by input)
        return Object.values(dataByDate);
    }

    // --- HTML Rendering Functions ---

    // Generates HTML structure for the Scatter View
    function renderScatterView(dataGroupedByDate, patientId) { // Added patientId
        let resultsTitle = 'Results Over Time (Scatter)';
        // Main container for results section
        let scatterHTML = `
            <div class="results-header">
                <h2 class="section-title" style="margin-top: 0; margin-bottom: 0.5em;">${resultsTitle}</h2>
                <div id="view-toggle-container">
                     <button id="view-scatter-btn" class="view-toggle-button ${currentViewMode === 'scatter' ? 'active' : ''}">
                         <i class="fas fa-chart-line mr-1"></i> Scatter View
                     </button>
                     <button id="view-bar-btn" class="view-toggle-button ${currentViewMode === 'bar' ? 'active' : ''}">
                         <i class="fas fa-chart-bar mr-1"></i> Bar Chart View
                     </button>
                 </div>
            </div>
            <div id="toggle-dates-container" style="display: none;"></div>

            <div id="graphs-and-summary-area">`;

        // Add graph containers for each position
        POSITIONS.forEach(pos => {
            scatterHTML += `
                <div class="graph-section-box">
                    <h3 class="graph-box-title">Position ${pos}</h3>
                    <div class="graph-grid graph-grid-scatter">
                        <div id="scatter-graph-${pos}-${METRIC_KEYS.MAX_FORCE}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                        <div id="scatter-graph-${pos}-${METRIC_KEYS.RFD}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                        <div id="scatter-graph-${pos}-${METRIC_KEYS.NORM}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                    </div>
                </div>
            `;
        });

        // Add the summary table container (will be populated later)
        scatterHTML += `<div id="summary-table-container"></div>`; // Single container for all tables

        scatterHTML += `</div>`; // Close graphs-and-summary-area
        return scatterHTML;
    }

    // Calls Plotly.react for each scatter plot and renders tables
    function renderScatterPlots(dataGroupedByDate) {
        POSITIONS.forEach(pos => {
            createTimeScatter(dataGroupedByDate, `scatter-graph-${pos}-${METRIC_KEYS.MAX_FORCE}`, METRIC_KEYS.MAX_FORCE, pos, false); // Max Force
            createTimeScatter(dataGroupedByDate, `scatter-graph-${pos}-${METRIC_KEYS.RFD}`, METRIC_KEYS.RFD, pos, false);       // RFD
            createTimeScatter(dataGroupedByDate, `scatter-graph-${pos}-${METRIC_KEYS.NORM}`, METRIC_KEYS.NORM, pos, true);      // Normalized Force (with norm zones)
        });
        // Render summary table for all positions into the single container
        const tableContainer = document.getElementById(`summary-table-container`);
        if(tableContainer) {
            tableContainer.innerHTML = renderCombinedSummaryTable(dataGroupedByDate);
        } else {
            console.error(`Container for summary table not found.`);
        }
    }

    // Generates HTML structure for the Bar Chart View
    function renderBarChartView(dataGroupedByDate, patientId) { // Added patientId
        let resultsTitle = 'Results Over Time (Bar Chart)';
        // Main container for results section
        let barHTML = `
            <div class="results-header">
                 <h2 class="section-title" style="margin-top: 0; margin-bottom: 0.5em;">${resultsTitle}</h2>
                 <div id="view-toggle-container">
                     <button id="view-scatter-btn" class="view-toggle-button ${currentViewMode === 'scatter' ? 'active' : ''}">
                         <i class="fas fa-chart-line mr-1"></i> Scatter View
                     </button>
                     <button id="view-bar-btn" class="view-toggle-button ${currentViewMode === 'bar' ? 'active' : ''}">
                         <i class="fas fa-chart-bar mr-1"></i> Bar Chart View
                     </button>
                 </div>
            </div>
             <div id="toggle-dates-container" style="display: none;"></div>

             <div id="graphs-and-summary-area">`;

        // Add graph containers for each position (excluding Normalized Force for bar charts)
        POSITIONS.forEach(pos => {
            barHTML += `
                <div class="graph-section-box">
                    <h3 class="graph-box-title">Position ${pos}</h3>
                    <div class="graph-grid graph-grid-bar">
                        <div id="bar-graph-${pos}-${METRIC_KEYS.MAX_FORCE}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                        <div id="bar-graph-${pos}-${METRIC_KEYS.RFD}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                    </div>
                </div>
            `;
        });

        // Add the summary table container (will be populated later)
         barHTML += `<div id="summary-table-container"></div>`; // Single container

        barHTML += `</div>`; // Close graphs-and-summary-area
        return barHTML;
    }

    // Calls Plotly.react for each bar chart and renders tables
    function renderBarCharts(dataGroupedByDate, injuredSide) {
        POSITIONS.forEach(pos => {
            createTimeSeriesBarChart(dataGroupedByDate, `bar-graph-${pos}-${METRIC_KEYS.MAX_FORCE}`, METRIC_KEYS.MAX_FORCE, pos, injuredSide); // Max Force
            createTimeSeriesBarChart(dataGroupedByDate, `bar-graph-${pos}-${METRIC_KEYS.RFD}`, METRIC_KEYS.RFD, pos, injuredSide);       // RFD
        });
         // Render summary table for all positions into the single container
         const tableContainer = document.getElementById(`summary-table-container`);
         if(tableContainer) {
             tableContainer.innerHTML = renderCombinedSummaryTable(dataGroupedByDate);
         } else {
             console.error(`Container for summary table not found.`);
         }
    }

    // Generates HTML for the combined summary table box
    function renderCombinedSummaryTable(dataGroupedByDate) {
         if (!dataGroupedByDate || dataGroupedByDate.length === 0) {
             return '<p class="text-center text-slate-500 italic mt-6">No test data available for summary table.</p>';
         }

         let combinedHTML = `<h2 class="section-title">Detailed Summary</h2>`;
         combinedHTML += `<div class="summary-container-box">`; // Outer box for all tables

         POSITIONS.forEach((pos, index) => {
             combinedHTML += `<div class="summary-position-block">`; // Block for each position
             combinedHTML += `<h3 class="section-title">Position ${pos}</h3>`;
             combinedHTML += `<div class="overflow-x-auto">`;
             combinedHTML += `<table class="summary-table">`;

             // --- Table Header ---
             combinedHTML += `<thead>`;
             combinedHTML += `<tr>`;
             combinedHTML += `<th class="metric-header">Metric</th>`;
             dataGroupedByDate.forEach(testData => {
                 const dateStr = testData['Test Date'] instanceof Date && !isNaN(testData['Test Date'])
                                 ? testData['Test Date'].toLocaleDateString('en-CA')
                                 : 'Invalid Date';
                 const weekStr = testData['Weeks Since First'] !== null
                                 ? `(Week ${testData['Weeks Since First']})`
                                 : '';
                 combinedHTML += `<th colspan="4" class="date-header">${dateStr}<br>${weekStr}</th>`;
             });
             combinedHTML += `</tr>`;
             combinedHTML += `<tr>`;
             combinedHTML += `<th class="metric-header">&nbsp;</th>`;
             dataGroupedByDate.forEach(() => {
                 combinedHTML += `<th class="sub-header">L Val</th>`;
                 combinedHTML += `<th class="sub-header">R Val</th>`;
                 combinedHTML += `<th class="sub-header">L Ch%</th>`;
                 combinedHTML += `<th class="sub-header">R Ch%</th>`;
             });
             combinedHTML += `</tr>`;
             combinedHTML += `</thead>`;

             // --- Table Body ---
             combinedHTML += `<tbody>`;
             METRICS_DISPLAY_ORDER.forEach(metricKey => {
                 combinedHTML += `<tr>`;
                 combinedHTML += `<td class="metric-label">${metricKey}</td>`;
                 for (let i = 0; i < dataGroupedByDate.length; i++) {
                     const currentTestData = dataGroupedByDate[i];
                     const previousTestData = i > 0 ? dataGroupedByDate[i - 1] : null;
                     const currentMetricData = currentTestData[pos]?.[metricKey];
                     const previousMetricData = previousTestData?.[pos]?.[metricKey];

                     const latestL = currentMetricData?.Left;
                     const previousL = previousMetricData?.Left;
                     const changeL = calculatePercentageChange(latestL, previousL);

                     const latestR = currentMetricData?.Right;
                     const previousR = previousMetricData?.Right;
                     const changeR = calculatePercentageChange(latestR, previousR);

                     combinedHTML += `<td class="left-value-cell">${formatValue(latestL, metricKey === METRIC_KEYS.NORM)}</td>`;
                     combinedHTML += `<td class="right-value-cell">${formatValue(latestR, metricKey === METRIC_KEYS.NORM)}</td>`;
                     combinedHTML += `<td class="${getChangeClass(changeL)}">${formatChange(changeL)}</td>`;
                     combinedHTML += `<td class="${getChangeClass(changeR)}">${formatChange(changeR)}</td>`;
                 }
                 combinedHTML += `</tr>`;
             });
             combinedHTML += `</tbody></table></div>`; // Close overflow-x-auto and table
             combinedHTML += `</div>`; // Close summary-position-block
         });

         combinedHTML += `</div>`; // Close summary-container-box
         combinedHTML += `<p class="summary-footer-note">* Change calculated vs. previous test date shown in the table.</p>`; // Add note after the box
         return combinedHTML;
     }


    // --- Helper Functions for Summary Table ---
    function calculatePercentageChange(latest, previous) {
        if (latest == null || previous == null || previous === 0) return null; // Cannot calculate change
        // Ensure previous is not zero before dividing
        return ((latest - previous) / Math.abs(previous)) * 100;
    }

    function formatValue(value, isNorm = false) {
        if (value == null) return '<span class="na">N/A</span>'; // Handle null/undefined
        // Format normalized values to 2 decimal places, others to 1
        return isNorm ? value.toFixed(2) : value.toFixed(1);
    }

    function formatChange(change) {
        if (change == null) return '<span class="na">N/A</span>'; // Handle null/undefined
        const sign = change >= 0 ? '+' : ''; // Add '+' sign for positive changes
        return `${sign}${change.toFixed(0)}%`; // Format as integer percentage
    }

    function getChangeClass(change) {
        if (change == null) return 'na';
        if (change > 0) return 'change-pos'; // Green for positive
        if (change < 0) return 'change-neg'; // Red for negative
        return 'change-zero'; // Neutral for zero change
    }

    // --- Plotting Functions ---

    // Creates a scatter plot over time (weeks)
    function createTimeScatter(dataGroupedByDate, elementId, yMetricKey, position, addNormBg) {
        const plotElement = document.getElementById(elementId);
        if (!plotElement) { console.error(`Element ${elementId} not found.`); return; }
        plotElement.innerHTML = ''; // Clear previous plot or loading message

        if (!dataGroupedByDate || dataGroupedByDate.length === 0) {
            plotElement.innerHTML = `<div class="loading-placeholder">No data for Position ${position}.</div>`; return;
        }

        // Prepare data for Plotly traces
        const xIndex = dataGroupedByDate.map((_, i) => i); // Use simple index for x-axis positioning
        const xWeeksNum = dataGroupedByDate.map(d => d['Weeks Since First']); // Use weeks for tick labels
        let yLeft = [], yRight = [], hoverTextLeft = [], hoverTextRight = [], yValuesForRange = [];

        // Determine Y-axis title based on metric key
        let yAxisTitle = yMetricKey;
        if (yMetricKey === METRIC_KEYS.NORM) yAxisTitle = 'Max Force / BW (N/kg)';

        // Extract data points and create hover text
        dataGroupedByDate.forEach((d, i) => {
            let valLeft = null, valRight = null;
            let metricData = d[position]?.[yMetricKey]; // Get data for the specific metric and position

            // Handle Normalized Force calculation if needed (should be pre-calculated now)
            if (yMetricKey === METRIC_KEYS.NORM) {
                metricData = d[position]?.[METRIC_KEYS.NORM];
                valLeft = metricData?.Left;
                valRight = metricData?.Right;
            } else if (metricData) {
                valLeft = metricData.Left;
                valRight = metricData.Right;
            }

            yLeft.push(valLeft); yRight.push(valRight);
            // Collect valid Y values to determine axis range
            if (valLeft != null) yValuesForRange.push(valLeft);
            if (valRight != null) yValuesForRange.push(valRight);

            // Create hover text for each point
            hoverTextLeft.push(`Week: ${xWeeksNum[i]}<br>${yAxisTitle}: ${valLeft != null ? formatValue(valLeft, yMetricKey === METRIC_KEYS.NORM) : 'N/A'} (L)`);
            hoverTextRight.push(`Week: ${xWeeksNum[i]}<br>${yAxisTitle}: ${valRight != null ? formatValue(valRight, yMetricKey === METRIC_KEYS.NORM) : 'N/A'} (R)`);
        });

        // Define Plotly traces for Left and Right sides
        const traces = [
            { x: xIndex, y: yLeft, mode: 'lines+markers', name: 'Left', line: { color: LEFT_COLOR, shape: 'spline', width: 2.5 }, marker: { color: LEFT_COLOR, size: 9, symbol: 'circle' }, text: hoverTextLeft, hoverinfo: 'text' },
            { x: xIndex, y: yRight, mode: 'lines+markers', name: 'Right', line: { color: RIGHT_COLOR, shape: 'spline', width: 2.5 }, marker: { color: RIGHT_COLOR, size: 9, symbol: 'square' }, text: hoverTextRight, hoverinfo: 'text' }
        ];

        // Calculate Y-axis range, considering normative thresholds if applicable
        let yRange = calculateAxisRange(yValuesForRange, addNormBg ? NORMATIVE_THRESHOLDS[position] : null, null, 0.1); // Use 10% padding

        // Define Plotly layout
        const layout = {
            xaxis: {
                 // Removed title property
                tickmode: 'array',
                tickvals: xIndex,
                ticktext: xWeeksNum.map(w => w === 0 ? 'First Test' : `Week ${w}`), // Format tick labels
                showgrid: true, gridcolor: 'var(--medium-gray)', zeroline: false,
                titlefont: { size: 13 }, tickfont: { size: 11 }
            },
            yaxis: {
                title: { text: yAxisTitle, font: {size: 13}},
                zeroline: true, showgrid: true, gridcolor: 'var(--medium-gray)', range: yRange,
                tickfont: { size: 11 }
            },
            margin: { l: 60, r: 20, t: 10, b: 40 }, // Reduced bottom margin
            hovermode: 'closest',
            legend: { orientation: "h", yanchor: "bottom", y: -0.20, xanchor: "center", x: 0.5, font: { size: 11 } }, // Adjusted legend y
            shapes: [], // Initialize shapes array for norm zones
            paper_bgcolor: 'rgba(0,0,0,0)', // Transparent background
            plot_bgcolor: 'rgba(0,0,0,0)',  // Transparent plot area
            font: { family: 'Avenir, sans-serif', size: 12, color: 'var(--dark-gray)' }
        };

        // Add normative background zones if required
        if (addNormBg && NORMATIVE_THRESHOLDS[position]) {
            const thresholds = NORMATIVE_THRESHOLDS[position];
            const finalYRangeMin = layout.yaxis.range[0]; const finalYRangeMax = layout.yaxis.range[1];
            const zones = [ // Define norm zones based on thresholds
                { y0: finalYRangeMin, y1: thresholds.poor_max, color: NORM_ZONE_COLORS.poor },
                { y0: thresholds.poor_max, y1: thresholds.good_min, color: NORM_ZONE_COLORS.average },
                { y0: thresholds.good_min, y1: thresholds.excellent_min, color: NORM_ZONE_COLORS.good },
                { y0: thresholds.excellent_min, y1: finalYRangeMax, color: NORM_ZONE_COLORS.excellent }
            ];
            // Create shape for each zone, clipped to the calculated Y-axis range
            zones.forEach(zone => {
                const effectiveY0 = Math.max(zone.y0, finalYRangeMin);
                const effectiveY1 = Math.min(zone.y1, finalYRangeMax);
                if (effectiveY1 > effectiveY0) { // Only draw if the zone has height within the range
                    layout.shapes.push({
                        type: 'rect', xref: 'paper', yref: 'y', // Reference paper for x, y-axis for y
                        x0: 0, y0: effectiveY0, x1: 1, y1: effectiveY1, // Span full width
                        fillcolor: zone.color, opacity: 0.5, layer: 'below', line: { width: 0 } // Style the zone
                    });
                }
            });
        }

        // Render the plot
        try { Plotly.react(elementId, traces, layout, plotlyConfig); }
        catch (error) { console.error(`Error plotting scatter ${elementId}:`, error); plotElement.innerHTML = `<div class="error-message p-4 text-center">Could not plot graph: ${error.message}</div>`; }
    }

    // Creates a grouped bar chart over time (weeks)
    function createTimeSeriesBarChart(dataGroupedByDate, elementId, yMetricKey, position, injuredSide) {
        const plotElement = document.getElementById(elementId);
        if (!plotElement) { console.error(`Element ${elementId} not found.`); return; }
        plotElement.innerHTML = ''; // Clear previous plot

        if (!dataGroupedByDate || dataGroupedByDate.length === 0) {
            plotElement.innerHTML = `<div class="loading-placeholder">No data for Position ${position}.</div>`; return;
        }

        // Prepare data
        const xIndex = dataGroupedByDate.map((_, i) => i);
        const xWeeksNum = dataGroupedByDate.map(d => d['Weeks Since First']);
        let yLeft = [], yRight = [], changesLeft = [], changesRight = [], yValuesForRange = [];

        // Determine healthy/injured side keys for asymmetry calculation
        const healthySide = injuredSide === 'Left' ? 'Right' : 'Left';
        const injuredSideKey = injuredSide === 'Left' ? 'Left' : 'Right';
        const healthySideKey = healthySide;

        // Extract data and calculate changes
        for (let i = 0; i < dataGroupedByDate.length; i++) {
            const currentData = dataGroupedByDate[i];
            const previousData = i > 0 ? dataGroupedByDate[i-1] : null;
            const currentMetricData = currentData[position]?.[yMetricKey];
            const previousMetricData = previousData?.[position]?.[yMetricKey];

            const valLeft = currentMetricData?.Left;
            const valRight = currentMetricData?.Right;
            const prevLeft = previousMetricData?.Left;
            const prevRight = previousMetricData?.Right;

            yLeft.push(valLeft); yRight.push(valRight);
            changesLeft.push(calculatePercentageChange(valLeft, prevLeft));
            changesRight.push(calculatePercentageChange(valRight, prevRight));

            if (valLeft != null) yValuesForRange.push(valLeft);
            if (valRight != null) yValuesForRange.push(valRight);
        }

        // Define bar traces
        const traceLeft = {
            x: xIndex, y: yLeft, type: 'bar', name: 'Left',
            marker: { color: LEFT_BAR_COLOR_RGBA }, width: 0.4,
            text: yLeft.map(v => v != null ? formatValue(v) : ''), // Display formatted value inside bar
            textposition: 'inside', insidetextanchor: 'middle',
            textfont: { color: '#ffffff', size: 11, weight: 'bold' },
            hoverinfo: 'x+y+name'
        };
        const traceRight = {
            x: xIndex, y: yRight, type: 'bar', name: 'Right',
            marker: { color: RIGHT_BAR_COLOR_RGBA }, width: 0.4,
            text: yRight.map(v => v != null ? formatValue(v) : ''),
            textposition: 'inside', insidetextanchor: 'middle',
            textfont: { color: '#ffffff', size: 11, weight: 'bold' },
            hoverinfo: 'x+y+name'
        };

        // --- Create Annotations for Asymmetry and Change ---
        const annotations = [];
        const asymmetryAnnotationYShift = 35; // Pixels above the bar for asymmetry %
        const changeAnnotationYShift = 18;    // Pixels above the bar for change %

        for (let i = 0; i < xIndex.length; i++) {
            const yL = yLeft[i]; const yR = yRight[i];
            const changeL = changesLeft[i]; const changeR = changesRight[i];

            // Calculate Asymmetry (Injured vs Healthy)
            const currentMetricData = dataGroupedByDate[i][position]?.[yMetricKey];
            const injuredValue = currentMetricData?.[injuredSideKey];
            const healthyValue = currentMetricData?.[healthySideKey];
            let diff = null; // Asymmetry percentage

            if (healthyValue != null && injuredValue != null && healthyValue !== 0) {
                diff = ((injuredValue / healthyValue) * 100) - 100;
            } else if (healthyValue === 0 && injuredValue === 0) {
                diff = 0; // Consider 0 vs 0 as no asymmetry
            } // Otherwise, diff remains null if one side is missing or healthy is 0

            // Determine color for asymmetry text
            let asymmetryColor;
            if (diff === null) { asymmetryColor = '#94a3b8'; } // Grey for N/A
            else if (diff >= -10) { asymmetryColor = '#16a34a'; } // Green if >= -10%
            else { asymmetryColor = '#dc2626'; } // Red if < -10%

            const asymmetryText = diff !== null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : 'N/A';
            const maxY = Math.max(yL ?? -Infinity, yR ?? -Infinity); // Find top of the higher bar for annotation placement

            // Add Asymmetry Annotation (above the bars)
            if (yL != null || yR != null) { // Only add if there's at least one bar
                annotations.push({
                    x: xIndex[i], y: maxY >= 0 ? maxY : 0, // Place relative to the top of the bar (or 0 if negative)
                    text: asymmetryText,
                    showarrow: false, font: { color: asymmetryColor, size: 14, weight: 'bold' },
                    xanchor: 'center', yanchor: 'bottom', yshift: asymmetryAnnotationYShift // Shift upwards
                });
            }

            // Add Change Annotations (Left and Right, slightly lower than asymmetry)
            const colorL = changeL === null ? '#94a3b8' : (changeL >= 0 ? '#16a34a' : '#dc2626');
            const colorR = changeR === null ? '#94a3b8' : (changeR >= 0 ? '#16a34a' : '#dc2626');

            if (yL != null && i > 0) { // Add change % for Left if not the first date
                annotations.push({
                    x: xIndex[i], y: maxY >= 0 ? maxY : 0,
                    text: formatChange(changeL), showarrow: false,
                    font: { color: colorL, size: 10 },
                    xanchor: 'center', yanchor: 'bottom', yshift: changeAnnotationYShift,
                    xshift: -24 // Shift left for the Left change %
                });
            }
            if (yR != null && i > 0) { // Add change % for Right if not the first date
                 annotations.push({
                    x: xIndex[i], y: maxY >= 0 ? maxY : 0,
                    text: formatChange(changeR), showarrow: false,
                    font: { color: colorR, size: 10 },
                    xanchor: 'center', yanchor: 'bottom', yshift: changeAnnotationYShift,
                    xshift: 24 // Shift right for the Right change %
                });
            }
        }

        // Calculate Y-axis range, adding padding for annotations
        let yRange = calculateAxisRange(yValuesForRange, null, annotations, 0.25); // Adjusted top padding factor

        // Define bar chart layout
        const layout = {
            barmode: 'group', // Group bars for Left/Right
            bargap: 0.2, bargroupgap: 0.1, // Spacing between bars
            xaxis: {
                 // Removed title property
                 tickmode: 'array',
                 tickvals: xIndex,
                 ticktext: xWeeksNum.map(w => w === 0 ? 'First Test' : `Week ${w}`), // Format tick labels
                showgrid: false, zeroline: false, showline: false, // Cleaner look for bar chart x-axis
                titlefont: { size: 13 }, tickfont: { size: 11 }
            },
            yaxis: {
                title: { text: yMetricKey, font: {size: 13}},
                zeroline: false, showgrid: false, showline: false, // Cleaner look for y-axis
                range: yRange,
                tickfont: { size: 11 }
            },
            margin: { l: 60, r: 20, t: 50, b: 40 }, // Adjusted top/bottom margin for annotations/legend
            hovermode: 'closest',
            legend: { orientation: "h", yanchor: "bottom", y: -0.25, xanchor: "center", x: 0.5, font: { size: 11 } }, // Adjusted legend y
            annotations: annotations, // Add the calculated annotations
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { family: 'Avenir, sans-serif', size: 12, color: 'var(--dark-gray)' },
            uniformtext: { mode: 'hide', minsize: 10 } // Hide text inside bars if it doesn't fit
        };

        // Render the plot
        try { Plotly.react(elementId, [traceLeft, traceRight], layout, plotlyConfig); }
        catch (error) { console.error(`Error plotting bar ${elementId}:`, error); plotElement.innerHTML = `<div class="error-message p-4 text-center">Could not plot graph: ${error.message}</div>`; }
    }

    // Calculates appropriate Y-axis range with padding
    function calculateAxisRange(values, thresholds = null, annotations = null, topPaddingFactor = 0.1) { // Reduced default top padding
        const validValues = values.filter(y => y != null && !isNaN(y)); // Filter out null/NaN

        // Determine min/max from data
        let yDataMin = validValues.length > 0 ? Math.min(...validValues) : 0;
        let yDataMax = validValues.length > 0 ? Math.max(...validValues) : 1; // Default max to 1 if no data

        // Include threshold values in range calculation if provided
        if (thresholds) {
            const thresholdValues = Object.values(thresholds).filter(v => typeof v === 'number');
            if (thresholdValues.length > 0) {
                yDataMin = Math.min(yDataMin, ...thresholdValues);
                yDataMax = Math.max(yDataMax, ...thresholdValues);
            }
        }

        // Include annotation positions in range calculation if provided
        if (annotations && annotations.length > 0) {
            let maxAnnotatedY = -Infinity;
             annotations.forEach(ann => {
                 if (ann.y != null && !isNaN(ann.y)) {
                     let annTop = ann.y;
                     // Estimate the top edge of the annotation based on anchor and shift
                     if (ann.yanchor === 'bottom') {
                         annTop += (ann.yshift || 0);
                         // Add estimated text height if shifted significantly
                         if ((ann.yshift || 0) > 10) annTop += (ann.font?.size || 12) * 1.2;
                     } else if (ann.yanchor === 'top') {
                          annTop -= (ann.yshift || 0); // Shift is likely negative or zero
                     } else { // Middle anchor
                          annTop += (ann.yshift || 0) + (ann.font?.size || 12) * 0.6; // Add half height approx
                     }
                     maxAnnotatedY = Math.max(maxAnnotatedY, annTop);
                 }
             });
             // If annotations go higher than data/thresholds, adjust max
             if (maxAnnotatedY > yDataMax) {
                 yDataMax = maxAnnotatedY;
             }
        }


        // Calculate padding based on the data range
        const yDataRange = yDataMax - yDataMin;
        // Ensure padding is reasonable, even for small ranges or negative values
        const bottomPaddingValue = Math.max(yDataRange * 0.10, Math.abs(yDataMin) * 0.1, 0.5); // Slightly reduced bottom padding factor
        const topPaddingValue = Math.max(yDataRange * topPaddingFactor, Math.abs(yDataMax) * topPaddingFactor, 1.0); // Use the passed topPaddingFactor

        // Calculate final range limits
        let rangeMin = yDataMin - bottomPaddingValue;
        let rangeMax = yDataMax + topPaddingValue;

        // Adjust range to include zero if data is close to it
        if (yDataMin >= 0) rangeMin = Math.min(0, rangeMin); // Ensure range starts at or below 0 if all data is positive
        if (yDataMax <= 0 && yDataMin < 0) rangeMax = Math.max(0, rangeMax); // Ensure range ends at or above 0 if all data is negative
        else if (yDataMax <= 0) rangeMax = 0.5; // If max is 0 or less, ensure range goes slightly positive

        // Final checks to prevent invalid ranges
        if (rangeMin >= rangeMax) { rangeMin = rangeMax - 1; } // Ensure min < max
        if (rangeMin === rangeMax) { rangeMin -= 0.5; rangeMax += 0.5; } // Add buffer if min equals max

        return [rangeMin, rangeMax];
    }

     // --- PDF Modal and Report Functions ---
     function openPdfModal() {
         if (!selectedPatientId || !allPatientData[selectedPatientId]) {
             alert("Please select a patient with data first.");
             return;
         }
         pdfModal.style.display = 'flex';
     }

     function closePdfModal() {
         pdfModal.style.display = 'none';
     }

     function showGraphReport() {
         if (!selectedPatientId) return;
         const data = getProcessedPatientData(selectedPatientId);
         if (!data || data.length === 0) {
             alert("No visible data to generate graph report.");
             closePdfModal();
             return;
         }

         mainContentArea.classList.add('report-active'); // Hide main content
         tableReportView.classList.remove('active'); // Hide other report view
         graphReportView.classList.add('active'); // Show this report view
         closePdfModal();

         graphReportContent.innerHTML = ''; // Clear previous content

         // Create temporary containers for graphs within the report view
         POSITIONS.forEach(pos => {
             const graphContainer = document.createElement('div');
             graphContainer.className = 'graph-section-box'; // Reuse styling
             graphContainer.innerHTML = `
                 <h3 class="graph-box-title">Position ${pos}</h3>
                 <div class="graph-grid ${currentViewMode === 'scatter' ? 'graph-grid-scatter' : 'graph-grid-bar'}">
                     ${currentViewMode === 'scatter' ? `
                         <div id="report-scatter-graph-${pos}-${METRIC_KEYS.MAX_FORCE}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                         <div id="report-scatter-graph-${pos}-${METRIC_KEYS.RFD}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                         <div id="report-scatter-graph-${pos}-${METRIC_KEYS.NORM}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                     ` : `
                         <div id="report-bar-graph-${pos}-${METRIC_KEYS.MAX_FORCE}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                         <div id="report-bar-graph-${pos}-${METRIC_KEYS.RFD}" class="plotly-graph-div"><div class="loading-placeholder">Loading graph...</div></div>
                     `}
                 </div>`;
             graphReportContent.appendChild(graphContainer);
         });

         // Render graphs into the new containers after a short delay
         setTimeout(() => {
             const groupedData = groupDataByDate(data);
             if (currentViewMode === 'scatter') {
                 POSITIONS.forEach(pos => {
                     createTimeScatter(groupedData, `report-scatter-graph-${pos}-${METRIC_KEYS.MAX_FORCE}`, METRIC_KEYS.MAX_FORCE, pos, false);
                     createTimeScatter(groupedData, `report-scatter-graph-${pos}-${METRIC_KEYS.RFD}`, METRIC_KEYS.RFD, pos, false);
                     createTimeScatter(groupedData, `report-scatter-graph-${pos}-${METRIC_KEYS.NORM}`, METRIC_KEYS.NORM, pos, true);
                 });
             } else {
                 POSITIONS.forEach(pos => {
                     createTimeSeriesBarChart(groupedData, `report-bar-graph-${pos}-${METRIC_KEYS.MAX_FORCE}`, METRIC_KEYS.MAX_FORCE, pos, latestInjuredSide);
                     createTimeSeriesBarChart(groupedData, `report-bar-graph-${pos}-${METRIC_KEYS.RFD}`, METRIC_KEYS.RFD, pos, latestInjuredSide);
                 });
             }
             // Ensure plots resize correctly if the container was hidden
             window.dispatchEvent(new Event('resize'));
         }, 100);
     }

     function showTableReport() {
         if (!selectedPatientId) return;
         const data = getProcessedPatientData(selectedPatientId);
          if (!data || data.length === 0) {
             alert("No visible data to generate table report.");
             closePdfModal();
             return;
         }

         mainContentArea.classList.add('report-active'); // Hide main content
         graphReportView.classList.remove('active'); // Hide other report view
         tableReportView.classList.add('active'); // Show this report view
         closePdfModal();

         tableReportContent.innerHTML = ''; // Clear previous content
         const groupedData = groupDataByDate(data);
         tableReportContent.innerHTML = renderCombinedSummaryTable(groupedData); // Render the table
     }

     function hideReportView() {
         mainContentArea.classList.remove('report-active'); // Show main content
         graphReportView.classList.remove('active');
         tableReportView.classList.remove('active');
         // Optional: Clear report content when hiding
         // graphReportContent.innerHTML = '';
         // tableReportContent.innerHTML = '';
     }


    // --- Initialization ---
    // Load saved data when the page loads
    document.addEventListener('DOMContentLoaded', loadAnalysisStateFromLocalStorage);

</script>

</body>
</html>
