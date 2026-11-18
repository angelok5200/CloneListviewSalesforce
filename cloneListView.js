import { LightningElement, wire } from 'lwc';
import getRecords from '@salesforce/apex/CloneListViewController.getRecords';
import getAusgabestelleKuerzel from '@salesforce/apex/getAusgabestelleKuerzel.getAusgabestelleKuerzel';
import { getListInfoByName,getListInfosByName, getListInfosByObjectName, createListInfo} from 'lightning/uiListsApi';
import { NavigationMixin} from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';


export default class CloneListView extends NavigationMixin(LightningElement) {
//#region Variables
    // Object whose List Views are being cloned.
    objectApiName = '';

    // User-entered source List View API Name.
    sourceListViewApiName = '';

    sourceInfo;
    newLabel = '';
    isLoading = false;
    isLoadingSource = false;

    errorMessage = '';
    successMessage = '';
    createdLists = [];

    records = [];
    selectedRecordIds = [];
    nextCursor = null;
    hasMoreRecords = false;

    isLoadingRecords = false;
    recordError = '';
    pageSize = 200;
    fieldApiName = '';

    existingListsData = [];
    existingListsLoaded = false;
    existingLists = [];

    listViewNames;
    existingListViewDetails = [];

    KuerzelToReplace = null;
    isLoadingKuerzel = false;

    existingListViewsLoaded = false;
    existingListViewsError = '';
    existingListViewsLoading = false;
//#endregion


//#region EventHandlers
handleObjectChange(event) {

    this.objectApiName = event.target.value.trim();

    this.existingLists = [];
    this.sourceInfo = undefined;
    this.newLabel = '';
    this.fieldApiName = '';

    this.sourceListViewApiName = '';

    this.listViewNames = undefined;
    this.existingListViewDetails = [];

    this.existingListViewsLoaded = false;
    this.existingListViewsLoading = !!this.objectApiName;
    this.existingListViewsError = '';

    this.errorMessage = '';
    this.successMessage = '';

    this.isLoadingSource = false;

    // Independent record loading
    this.loadFirstPage();
}

handleSourceNameChange(event) {

    this.sourceListViewApiName =
        event.target.value.trim();

    this.sourceInfo = undefined;
    this.newLabel = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.fieldApiName = '';

    this.isLoadingSource = !!(
        this.objectApiName &&
        this.sourceListViewApiName
    );
}

handleSelectAll(event) {

    const checked = event.target.checked;

    if (checked) {

        this.selectedRecordIds = [
            ...new Set([
                ...this.selectedRecordIds,
                ...this.records.map(record => record.id)
            ])
        ];

    } else {

        const loadedIds = new Set(
            this.records.map(record => record.id)
        );

        this.selectedRecordIds =
            this.selectedRecordIds.filter(
                id => !loadedIds.has(id)
            );
    }

    this.records = this.records.map(record => ({

        ...record,

        selected: checked

    }));
}

async handleFieldChange(event) {

    this.fieldApiName = event.detail.value;

    // Reset previous values
    this.KuerzelToReplace = '';
    this.selectedFilterField = '';
    this.selectedFilterValue = '';

    try {

        // Get the selected filter value from sourceInfo
        this.getSelectedFilter();

        // Load records for the selected field
        await this.loadFirstPage();

        // Call Apex only for Ausgabestelle
        await this.callApexIfAusgabestelle();

    } catch (error) {

        console.error('FIELD CHANGE ERROR:', error);

        this.errorMessage = this.reduceError(error);
    }
}

handleLoadMore() {
    this.loadRecords();
}

handleRecordSelection(event) {

    const recordId = event.target.dataset.recordId;

    const checked = event.target.checked;

    if (checked) {

        if (!this.selectedRecordIds.includes(recordId)) {

            this.selectedRecordIds = [
                ...this.selectedRecordIds,
                recordId
            ];
        }

    } else {

        this.selectedRecordIds =
            this.selectedRecordIds.filter(
                id => id !== recordId
            );
    }

    this.records = this.records.map(record => ({

        ...record,

        selected: this.selectedRecordIds.includes(record.id)

    }));
}
//#endregion EventHandlers


//#region WireServices    
@wire(getListInfoByName, {
    objectApiName: '$objectApiName',
    listViewApiName: '$wiredSourceListViewApiName'
})
wiredListInfo({ data, error }) {

    if (data) {

        this.sourceInfo = data;
        this.isLoadingSource = false;
        this.errorMessage = '';
        this.newLabel = data.label;

        console.log(
            'SOURCE LIST VIEW LOADED:',
            JSON.stringify(data, null, 2)
        );

    } else if (error) {

        this.sourceInfo = undefined;
        this.isLoadingSource = false;

        this.errorMessage = this.reduceError(error);

        console.error(
            'SOURCE LIST VIEW ERROR:',
            JSON.stringify(error, null, 2)
        );
    }
}

// --------------------------------------------------
// GET ALL LIST VIEW NAMES FOR THE OBJECT
// --------------------------------------------------

@wire(getListInfosByObjectName, {
    objectApiName: '$objectApiName',
    pageSize: 2000,
    recentListsOnly: false
})
wiredExistingListNames({ data, error }) {

    if (data) {

        const lists = data.lists || [];

        this.existingListViewDetails = [];

        if (!lists.length) {

            this.listViewNames = undefined;
            this.existingListViewsLoaded = true;
            this.existingListViewsLoading = false;

            return;
        }

        this.listViewNames = lists.map(list =>
            `${this.objectApiName}.${list.apiName}`
        );

        console.log(
            'LIST VIEW NAMES LOADED:',
            this.listViewNames.length
        );

    } else if (error) {

        this.listViewNames = undefined;
        this.existingListViewsLoaded = true;
        this.existingListViewsLoading = false;

        this.existingListViewsError =
            this.reduceError(error);

        console.error('LIST NAME ERROR:', error);
    }
}


// --------------------------------------------------
// GET FILTER DETAILS FOR ALL EXISTING LIST VIEWS
// --------------------------------------------------

@wire(getListInfosByName, {
    names: '$listViewNames'
})
wiredExistingListDetails({ data, error }) {

    if (data) {

        const results = data.results || [];

        this.existingListViewDetails = results
            .filter(item =>
                item.result &&
                !item.result.errorCode
            )
            .map(item => item.result);

        this.existingListViewsLoaded = true;
        this.existingListViewsLoading = false;

        console.log(
            'DUPLICATE CHECK DATA READY:',
            this.existingListViewDetails.length
        );

    } else if (error) {

        this.existingListViewDetails = [];

        this.existingListViewsLoaded = true;
        this.existingListViewsLoading = false;

        this.existingListViewsError =
            this.reduceError(error);

        console.error('LIST DETAILS ERROR:', error);
    }
}

//#endregion WireServices 


//#region Getters

    get wiredSourceListViewApiName() {
        return (
            this.objectApiName &&
            this.sourceListViewApiName
        )
            ? this.sourceListViewApiName
            : undefined;
    }

    get debugStatus() {
    return {
        objectApiName: this.objectApiName,
        sourceListViewApiName: this.sourceListViewApiName,
        sourceInfoLoaded: !!this.sourceInfo,
        isLoadingSource: this.isLoadingSource,
        isLoading: this.isLoading,
        newLabel: this.newLabel,
        buttonDisabled: this.isCloneDisabled
    };
    }

    get isCloneDisabled() {

        return (
            this.isLoading ||
            this.isLoadingSource ||
            !this.sourceInfo ||
            !this.objectApiName ||
            !this.fieldApiName ||
            !this.sourceListViewApiName ||
            !this.existingListViewsLoaded ||
            !!this.existingListViewsError ||
            this.selectedRecordIds.length === 0
        );
    }

    get columnCount() {
        return this.sourceInfo?.displayColumns?.length || 0;
    }

    get sourceLoaded() {
        return !!this.sourceInfo;
    }

    // --------------------------------------------------
// SELECTION GETTERS
// --------------------------------------------------

    get selectedCount() {
        return this.selectedRecordIds.length || 0;
    }

    get hasRecords() {
        return (this.records?.length || 0) > 0;
    }

    get allLoadedSelected() {

        return (
            this.records.length > 0 &&
            this.records.every(record => record.selected)
        );
    }

    get filterFieldNames() {
        return (this.sourceInfo?.filteredByInfo || [])
            .map(filter => filter.fieldApiName);
    }

    get filterFieldOptions() {
        return this.filterFieldNames.map(field => ({
            label: field,
            value: field
        }));
    }

    get debugLengths() {
        return {
            selectedRecordIds: this.selectedRecordIds?.length,
            records: this.records?.length,
            existingLists: this.existingLists?.length,
            createdLists: this.createdLists?.length,
            existingListsData: this.existingListsData?.length,
            listViewNames: this.listViewNames?.length
        };
    }
//#endregion Getters


//#region NameAndRequestBuilder
normalizeApiValue(value) {

    return String(value || '')
        .trim()
        .replace(/[äöüÄÖÜß]/g, char => ({
            'ä': 'ae',
            'ö': 'oe',
            'ü': 'ue',
            'Ä': 'Ae',
            'Ö': 'Oe',
            'Ü': 'Ue',
            'ß': 'ss'
        })[char])
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}
/*
buildApiName(recordName, additionalFieldValue = '') {

    console.log('BUILD API NAME START');

console.log('KuerzelToReplace:', this.KuerzelToReplace);

console.log('Additional Field Value:', additionalFieldValue);

console.log('Original Filter:', this.getSelectedFilter());

    // EXISTING LOGIC: Original filter value
    const originalFilterValue = this.getSelectedFilter();

    const oldValue = this.normalizeApiValue(
        originalFilterValue
    );

    // EXISTING LOGIC: Record name
    const combinedRecordName = additionalFieldValue
        ? `${additionalFieldValue}_${recordName}`
        : recordName;

    const newValue = this.normalizeApiValue(
        combinedRecordName
    );

    // EXISTING LOGIC: Original API Name
    const originalApiName = this.normalizeApiValue(
        this.sourceInfo.label
    );

    if (!oldValue || !newValue || !originalApiName) {
        throw new Error('Original or selected filter value is invalid.');
    }

    // EXISTING LOGIC: Find original filter value
    const escapedOldValue = oldValue.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );

    const regex = new RegExp(
        `(^|_)(${escapedOldValue}[a-zA-Z]{0,4})(?=_|$)`,
        'g'
    );

    if (!regex.test(originalApiName)) {
        throw new Error(
            `Filter value "${oldValue}" was not found in Label "${this.sourceInfo.label}".`
        );
    }

    regex.lastIndex = 0;

    // EXISTING LOGIC: First replacement
    let newApiName = originalApiName.replace(
        regex,
        (match, prefix) => prefix + newValue
    );


    // ==================================================
    // NEW LOGIC: Replace KuerzelToReplace
    // ==================================================

    if (this.KuerzelToReplace && additionalFieldValue) {

        const oldKuerzel = this.normalizeApiValue(
            this.KuerzelToReplace
        );

        const newKuerzel = this.normalizeApiValue(
            additionalFieldValue
        );

        const escapedKuerzel = oldKuerzel.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );

        const kuerzelRegex = new RegExp(
            `(^|_)${escapedKuerzel}(?=_|$)`,
            'g'
        );

        console.log('Old kuerzel:', kuerzelRegex + 'oder' + escapedKuerzel);

        if (!kuerzelRegex.test(newApiName)) {
            throw new Error(
                `Kürzel "${oldKuerzel}" was not found in API Name "${newApiName}".`
            );
        }

        kuerzelRegex.lastIndex = 0;

        // Second replacement
        newApiName = newApiName.replace(
            kuerzelRegex,
            (match, prefix) => prefix + newKuerzel
        );
    }

    // EXISTING VALIDATION
    if (
        newApiName.length > 40 ||
        !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(newApiName) ||
        /__/.test(newApiName) ||
        /_$/.test(newApiName)
    ) {
        throw new Error(
            `Invalid generated API Name: ${newApiName}`
        );
    }

    return newApiName;
}*/

buildApiName(recordName, additionalFieldValue = '') {

    console.log('BUILD API NAME START');
    console.log('KuerzelToReplace:', this.KuerzelToReplace);
    console.log('Additional Field Value:', additionalFieldValue);

    // 1. ORIGINAL FILTER VALUE
    const originalFilterValue = this.getSelectedFilter();

    const oldValue = this.normalizeApiValue(
        originalFilterValue
    );

    // 2. NEW RECORD NAME
    const newValue = this.normalizeApiValue(
        recordName
    );

    // 3. ORIGINAL API NAME
    const originalApiName = this.normalizeApiValue(
        this.sourceInfo.label
    );

    if (!oldValue || !newValue || !originalApiName) {
        throw new Error(
            'Original or selected filter value is invalid.'
        );
    }

    // Helper: escape regex special characters
    const escapeRegex = value =>
        value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // ==================================================
    // FIRST REPLACEMENT: FILTER VALUE -> RECORD NAME
    // ==================================================

    const filterRegex = new RegExp(
        `(^|_)${escapeRegex(oldValue)}[a-zA-Z]{0,4}(?=_|$)`,
        'gi'
    );

    if (!filterRegex.test(originalApiName)) {
        throw new Error(
            `Filter value "${oldValue}" was not found in Label "${this.sourceInfo.label}".`
        );
    }

    filterRegex.lastIndex = 0;

    let newApiName = originalApiName.replace(
        filterRegex,
        (match, prefix) => prefix + newValue
    );

    console.log('After first replacement:', newApiName);

    // ==================================================
    // SECOND REPLACEMENT: OLD KÜRZEL -> NEW KÜRZEL
    // ==================================================

    if (this.KuerzelToReplace && additionalFieldValue) {

        const oldKuerzel = this.normalizeApiValue(
            this.KuerzelToReplace
        );

        const newKuerzel = this.normalizeApiValue(
            additionalFieldValue
        );

        if (!oldKuerzel || !newKuerzel) {
            throw new Error('Invalid Kürzel value.');
        }

        const kuerzelRegex = new RegExp(
            `(^|_)${escapeRegex(oldKuerzel)}(?=_|$)`
        );

        if (!kuerzelRegex.test(newApiName)) {
            throw new Error(
                `Kürzel "${oldKuerzel}" was not found in API Name "${newApiName}".`
            );
        }

        newApiName = newApiName.replace(
            kuerzelRegex,
            (match, prefix) => prefix + newKuerzel
        );
    }

    console.log('Final API Name:', newApiName);

    // ==================================================
    // VALIDATION
    // ==================================================

    if (
        newApiName.length > 40 ||
        !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(newApiName) ||
        /__/.test(newApiName) ||
        /_$/.test(newApiName)
    ) {
        throw new Error(
            `Invalid generated API Name: ${newApiName}`
        );
    }

    return newApiName;
}


async buildCreateRequest(recordName) {

    const source = this.sourceInfo;
    const newApiName = this.buildApiName(recordName.label, recordName.additionalFieldValue);
    const newLabel = newApiName.replace(/_/g, ' ');

    if (!recordName.label) {
        throw new Error('Selected record Name is missing.');
    }

    // Build sharing configuration only for Shared List Views
let listShares = [];

if (source.visibility === 'Shared') {

    console.log(
        'SOURCE LIST SHARES:',
        JSON.stringify(source.listShares, null, 2)
    );

    listShares = this.buildListShares();

    if (!listShares.length) {
        throw new Error(
            'No sharing entities could be resolved.'
        );
    }

    console.log(
        'RESOLVED LIST SHARES:',
        JSON.stringify(listShares, null, 2)
    );
}

    const request = {

        objectApiName: this.objectApiName,

        listViewApiName: newApiName,

        label: `${newLabel}`.substring(0, 40),

        displayColumns: (
            source.displayColumns || []
        ).map(column => column.fieldApiName),

        scope: {
            apiName: source.scope?.apiName || 'everything'
        },

        filteredByInfo: this.buildFilters(this.fieldApiName, recordName.label),

        visibility: source.visibility || 'Private',

        ...(source.visibility === 'Shared'
        ? { listShares: this.buildListShares() }
        : {})
    };

    return request;
}


buildFilters(targetFieldApiName, newValue) {

    const sourceFilters =
        this.sourceInfo?.filteredByInfo || [];

    return sourceFilters.map(filter => ({
        fieldApiName: filter.fieldApiName,
        operator: filter.operator,
        operandLabels:
            filter.fieldApiName === targetFieldApiName
                ? [newValue]
                : filter.operandLabels
    }));
}



buildListShares() {

    const sourceShares = this.sourceInfo?.listShares || [];

    return sourceShares.flatMap(group => {

        if (!group.shareType || !Array.isArray(group.shares)) {
            return [];
        }

        return group.shares
            .filter(share => share.shareApiName)
            .map(share =>
                `${group.shareType}.${share.shareApiName}`
            );
    });
}



getSelectedFilter() {

    const source = this.sourceInfo;

    if (!Array.isArray(source.filteredByInfo)) {
        throw new Error('Source List View has no filters.');
    }

    const selectedFilter = source.filteredByInfo.find(
        filter => filter.fieldApiName === this.fieldApiName
    );

    if (!selectedFilter) {
        throw new Error('Selected filter was not found.');
    }

    const originalFilterValue = String(
        selectedFilter.operandLabels?.[0] || ''
    ).trim();

    if (!originalFilterValue) {
        throw new Error('Original filter value is empty.');
    }

    this.selectedFilterField = selectedFilter.fieldApiName;
    this.selectedFilterValue = originalFilterValue;

    return originalFilterValue;
}
//#endregion NameAndRequestBuilder


//#region RecordManagement

async loadFirstPage() {

    this.records = [];
    this.selectedRecordIds = [];

    this.nextCursor = null;
    this.hasMoreRecords = false;

    this.recordError = '';

    if (!this.objectApiName) {
        return;
    }

    await this.loadRecords();
}

async loadRecords() {

    if (
        !this.objectApiName ||
        !this.fieldApiName ||
        this.isLoadingRecords
    ) {
        return;
    }

    this.isLoadingRecords = true;
    this.recordError = '';

    try {

        const result = await getRecords({

            objectApiName: this.objectApiName,

            fieldApiName: this.fieldApiName,

            lastRecordId: this.nextCursor,

            pageSize: this.pageSize
            
        });

        

        const newRecords = result.records.map(record => ({

            id: record.recordId,

            label: record.label,

            additionalFieldValue: record.additionalFieldValue,

            selected: this.selectedRecordIds.includes(
                record.recordId
            )

        }));

        console.log(
    'FULL APEX RESPONSE:',
    JSON.stringify(result, null, 2)
);

result.records.forEach(record => {

    console.log('LABEL:', record.label);

    console.log('RECORD ID:', record.recordId);

    console.log(
        'ADDITIONAL FIELD:',
        record.additionalFieldValue
    );
});
        this.records = [
            ...this.records,
            ...newRecords
        ];

        this.nextCursor = result.nextCursor;

        this.hasMoreRecords = result.hasMore;

    } catch (error) {

        console.error('RECORD LOAD ERROR:', error);

        this.recordError = this.reduceError(error);

    } finally {

        this.isLoadingRecords = false;
    }
}

async callApexIfAusgabestelle() {

    console.log('FIELD:', this.fieldApiName);
    console.log('SELECTED FILTER:', this.selectedFilterValue);

    if (!this.fieldApiName?.includes('Ausgabestelle')) {

        console.log('Not an Ausgabestelle field.');

        this.KuerzelToReplace = null;

        return;
    }

    if (!this.selectedFilterValue) {

        console.error('Selected filter value is empty.');

        this.errorMessage = 'Selected filter value is empty.';

        return;
    }

    this.isLoadingKuerzel = true;

    try {

        const result = await getAusgabestelleKuerzel({

            selectedFilterValue: this.selectedFilterValue

        });

        console.log('APEX RETURN VALUE:', result);

        this.KuerzelToReplace = result;

        console.log(
            'KuerzelToReplace AFTER ASSIGNMENT:',
            this.KuerzelToReplace
        );

        if (!result) {

            console.warn(
                'No Ausgabestelle Kürzel found for:',
                this.selectedFilterValue
            );
        }

    } catch (error) {

        console.error(
            'APEX CALL FAILED:',
            JSON.stringify(error)
        );

        this.errorMessage = this.reduceError(error);

    } finally {

        this.isLoadingKuerzel = false;
    }
}
//#endregion RecordManagement


//#region ListViewCloning
isAlreadyExist(request) {

    const existingList = this.existingListViewDetails.find(
        list =>
            list.listReference?.listViewApiName?.toLowerCase() ===
            request.listViewApiName.toLowerCase()
    );

    return existingList || null;
}

async handleClone() {

    this.existingLists = [];
    this.errorMessage = '';
    this.successMessage = '';
    this.createdLists = [];

    try {

        this.validateClone();

        const selectedIds = [...this.selectedRecordIds];

        console.log('SELECTED RECORDS:', selectedIds);
        console.log('SELECTED COUNT:', selectedIds.length);

        this.isLoading = true;

        let successCount = 0;

        const failedLists = [];
        const createdLists = [];


        for (let i = 0; i < selectedIds.length; i++) {

            const result = await this.processSelectedRecord(
                selectedIds[i],
                i,
                selectedIds.length
            );

            if (result?.created) {

                createdLists.push(result.created);
                successCount++;

            } else if (result?.failed) {

                failedLists.push(result.failed);

            } else if (result?.error) {

                failedLists.push({
                    label: selectedIds[i],
                    error: result.error
                });
            }
        }

        this.displayCloneResults(
            successCount,
            selectedIds.length,
            failedLists,
            createdLists
        );

    } catch (error) {

        console.error('CLONING ERROR:', error);

        this.errorMessage = this.reduceError(error);

    } finally {

        this.isLoading = false;
    }
}

validateClone() {

    if (!this.sourceInfo) {
        throw new Error('Source List View has not loaded.');
    }

    if (!this.selectedRecordIds.length) {
        throw new Error('Please select at least one record.');
    }

    if (this.newLabel.trim().length > 40) {
        throw new Error('List View label cannot exceed 40 characters.');
    }

    if (!this.fieldApiName) {
        throw new Error('Please select a filter field.');
    }

    if (
        this.sourceInfo.cloneable === false ||
        this.sourceInfo.createable === false
    ) {
        throw new Error(
            'You do not have permission to clone this List View.'
        );
    }

    if (!this.existingListViewsLoaded) {
        throw new Error(
            'Please wait until existing List View filters have loaded.'
        );
    }
}

async handleExistingList(request) {

    const alreadyExists = this.isAlreadyExist(request);

    if (!alreadyExists) {
        return false;
    }

    const existingApiName =
        alreadyExists.listReference?.listViewApiName;

    const existingUrl = await this.getExistingListViewUrl(
        existingApiName
    );

    this.existingLists.push({
        label: alreadyExists.label,
        apiName: existingApiName,
        url: existingUrl
    });

    console.log('LIST VIEW ALREADY EXISTS:', existingApiName);

    return true;
}

async createClonedList(request) {

    await createListInfo(request);

    this.existingListsData = [
        ...this.existingListsData,
        {
            apiName: request.listViewApiName,
            label: request.label
        }
    ];

    const pageReference = {

        type: 'standard__objectPage',

        attributes: {
            objectApiName: this.objectApiName,
            actionName: 'list'
        },

        state: {
            filterName: request.listViewApiName
        }
    };

    const url = await this[
        NavigationMixin.GenerateUrl
    ](pageReference);

    return {
        label: request.label,
        apiName: request.listViewApiName,
        url: url
    };
}

async handleCloneError(error, request) {

    console.error('ERROR BODY:', JSON.stringify(error?.body, null, 2));
    console.error('ERROR MESSAGE:', error?.body?.message);
    console.error('ERROR STATUS:', error?.status);
    console.error('ERROR DETAILS:', error);

    const errorMessage = this.reduceError(error);

    const isDuplicateApiName =
        /already exists|duplicate|duplicate value|list view.*exists/i
            .test(errorMessage);

    if (isDuplicateApiName) {

        const existingUrl = await this.getExistingListViewUrl(
            request.listViewApiName
        );

        if (existingUrl) {

            this.existingLists.push({
                label: request.label,
                apiName: request.listViewApiName,
                url: existingUrl
            });

            return null;
        }
    }

    return {
        label: request.label,
        error: errorMessage
    };
}

async processSelectedRecord(recordId, index, total) {

    const selectedRecord = this.records.find(
        record => record.id === recordId
    );

    if (!selectedRecord) {
        return {
            error: `Selected record ${recordId} was not found.`
        };
    }

    const request = await this.buildCreateRequest(
        selectedRecord
    );

    console.log(
        `CREATING LIST ${index + 1}/${total}`,
        JSON.stringify(request, null, 2)
    );

    try {

        const alreadyExists = await this.handleExistingList(request);

        if (alreadyExists) {
            return null;
        }

        const createdList = await this.createClonedList(request);

        return {
            created: createdList
        };

    } catch (error) {

        return {
            failed: await this.handleCloneError(error, request)
        };
    }
}
//#endregion ListViewCloning


//#region ResultAndError
displayCloneResults(successCount, total, failedLists, createdLists) {

    this.createdLists = [...createdLists];

    this.successMessage =
        `${successCount} of ${total} List Views created successfully.`;

    if (failedLists.length) {

        this.errorMessage = failedLists.map(item =>
            item.error
                ? `${item.label || 'Unknown'}: ${item.error}`
                : `${item.label}: List View already exists with identical filters.`
        ).join('\n');
    }

    console.log('SUCCESS COUNT:', successCount);
    console.log('CREATED LISTS:', createdLists);
    console.log('FAILED LISTS:', failedLists);

    this.dispatchEvent(
        new ShowToastEvent({

            title: 'Cloning completed',

            message: this.successMessage,

            variant: failedLists.length ? 'warning' : 'success',

            mode: 'sticky'
        })
    );
}

async getExistingListViewUrl(apiName) {

    try {

        const pageReference = {

            type: 'standard__objectPage',

            attributes: {
                objectApiName: this.objectApiName,
                actionName: 'list'
            },

            state: {
                filterName: apiName
            }
        };

        const url = await this[
            NavigationMixin.GenerateUrl
        ](pageReference);

        return url;

    } catch (error) {

        console.error(
            'ERROR GENERATING EXISTING LIST URL:',
            error
        );

        return null;
    }
}

reduceError(error) {

        if (!error) {
            return 'Unknown Salesforce error.';
        }

        const messages = [];

        if (error.message) {
            messages.push(error.message);
        }

        if (error.body?.message) {
            messages.push(error.body.message);
        }

        if (Array.isArray(error.body)) {
            error.body.forEach(item => {
                if (item.message) {
                    messages.push(item.message);
                }
            });
        }

        if (error.body?.output?.errors) {
            error.body.output.errors.forEach(item => {
                messages.push(item.message);
            });
        }

        if (error.body?.pageErrors) {
            error.body.pageErrors.forEach(item => {
                messages.push(item.message);
            });
        }

        return messages.length
            ? [...new Set(messages)].join(' | ')
            : JSON.stringify(error);
    }
//#endregion ListViewCloning
}