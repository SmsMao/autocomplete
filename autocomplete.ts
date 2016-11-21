/**
*  Ajax Autocomplete for jQuery, version 1.2.26
*  (c) 2015 Tomas Kirda
*
*  Ajax Autocomplete for jQuery is freely distributable under the terms of an MIT-style license.
*  For details, see the web site: https://github.com/devbridge/jQuery-Autocomplete
*/
(function () {

    class DbAutocomplete {

        private static keys = { ESC: 27, TAB: 9, RETURN: 13, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 };
        private killerFn: (eventObject: JQueryEventObject, ...args: any[]) => any;
        private element: HTMLInputElement;
        private el: JQuery;
        private visible: boolean; disabled: boolean;
        private suggestions: Array<DbAutocompleteSuggestion>; badQueries: Array<string>;
        private selectedIndex: number;
        private currentValue: string;
        private intervalId: number;
        private cachedResponse: Object;
        private onChangeInterval: number; onChange: Function;
        private isLocal: boolean;
        private suggestionsContainer: HTMLElement; noSuggestionsContainer: HTMLElement;
        private options: DbAutocompleteOptions;
        private classes: { selected: string, suggestion: string }
        private hint: DbAutocompleteSuggestion; hintValue: string; selection: DbAutocompleteSuggestion;
        private currentRequest: JQueryPromise<any>;
        
        constructor(el: HTMLInputElement, options: DbAutocompleteOptions) {
            let noop = $.noop,
                that = this,
                defaults = {
                    ajaxSettings: {},
                    autoSelectFirst: false,
                    appendTo: document.body,
                    serviceUrl: null,
                    lookup: null,
                    onSelect: null,
                    width: 'auto',
                    minChars: 1,
                    maxHeight: 300,
                    deferRequestBy: 0,
                    params: {},
                    formatResult: DbAutocomplete.formatResult,
                    delimiter: null,
                    zIndex: 9999,
                    type: 'GET',
                    noCache: false,
                    onSearchStart: noop,
                    onSearchComplete: noop,
                    onSearchError: noop,
                    preserveInput: false,
                    containerClass: 'autocomplete-suggestions',
                    tabDisabled: false,
                    dataType: 'text',
                    currentRequest: null,
                    triggerSelectOnValidInput: true,
                    preventBadQueries: true,
                    lookupFilter: function (suggestion, originalQuery, queryLowerCase) {
                        return suggestion.value.toLowerCase().indexOf(queryLowerCase) !== -1;
                    },
                    paramName: 'query',
                    transformResult: function (response) {
                        return typeof response === 'string' ? $.parseJSON(response) : response;
                    },
                    showNoSuggestionNotice: false,
                    noSuggestionNotice: 'No results',
                    orientation: 'bottom',
                    forceFixPosition: false
                };

            // Shared variables:
            that.element = el;
            that.el = $(el);
            that.suggestions = [];
            that.badQueries = [];
            that.selectedIndex = -1;
            that.currentValue = that.element.value;
            that.intervalId = 0;
            that.cachedResponse = {};
            that.onChangeInterval = null;
            that.onChange = null;
            that.isLocal = false;
            that.suggestionsContainer = null;
            that.noSuggestionsContainer = null;
            that.options = $.extend({}, defaults, options);
            that.classes = {
                selected: 'autocomplete-selected',
                suggestion: 'autocomplete-suggestion'
            };
            that.hint = null;
            that.hintValue = '';
            that.selection = null;

            // Initialize and set options:
            that.initialize();
            that.setOptions(options);
        }

        private initialize() {
            let that = this,
                suggestionSelector = '.' + that.classes.suggestion,
                selected = that.classes.selected,
                options = that.options,
                container;

            // Remove autocomplete attribute to prevent native suggestions:
            that.element.setAttribute('autocomplete', 'off');

            that.killerFn = function (e) {
                if (!$(e.target).closest('.' + that.options.containerClass).length) {
                    that.killSuggestions();
                    that.disableKillerFn();
                }
            };

            // html() deals with many types: htmlString or Element or Array or jQuery
            that.noSuggestionsContainer = $('<div class="autocomplete-no-suggestion"></div>')
                .html(<string>this.options.noSuggestionNotice).get(0);

            that.suggestionsContainer = DbAutocompleteUtils.createNode(options.containerClass);

            container = $(that.suggestionsContainer);

            container.appendTo(options.appendTo);

            // Only set width if it was provided:
            if (options.width !== 'auto') {
                container.css('width', options.width);
            }

            // Listen for mouse over event on suggestions list:
            container.on('mouseover.autocomplete', suggestionSelector, function () {
                that.activate($(this).data('index'));
            });

            // Deselect active element when mouse leaves suggestions container:
            container.on('mouseout.autocomplete', function () {
                that.selectedIndex = -1;
                container.children('.' + selected).removeClass(selected);
            });

            // Listen for click event on suggestions list:
            container.on('click.autocomplete', suggestionSelector, function () {
                that.select($(this).data('index'));
                return false;
            });
            
            $(window).on('resize.autocomplete', that.fixPositionCapture);

            that.el.on('keydown.autocomplete', function (e) { that.onKeyPress(e); });
            that.el.on('keyup.autocomplete', function (e) { that.onKeyUp(e); });
            that.el.on('blur.autocomplete', function () { that.onBlur(); });
            that.el.on('focus.autocomplete', function () { that.onFocus(); });
            that.el.on('change.autocomplete', function (e) { that.onKeyUp(e); });
            that.el.on('input.autocomplete', function (e) { that.onKeyUp(e); });
        }

        private fixPositionCapture() {
            let that = this;

            if (that.visible) {
                that.fixPosition();
            }
        }
 
        private onFocus() {
            let that = this;

            that.fixPosition();

            if (that.el.val().length >= that.options.minChars) {
                that.onValueChange();
            }
        }

        private onBlur() {
            this.enableKillerFn();
        }

        private abortAjax() {
            let that = this;
            let request = <JQueryXHR>that.currentRequest;
            if (request) {
                request.abort();
                request = null;
            }
        }

        private setOptions(suppliedOptions: DbAutocompleteOptions) {
            let that = this,
                options = that.options;

            $.extend(options, suppliedOptions);

            that.isLocal = $.isArray(options.lookup);

            if (that.isLocal) {
                options.lookup = that.verifySuggestionsFormat(options.lookup);
            }

            options.orientation = that.validateOrientation(options.orientation, 'bottom');

            // Adjust height, width and z-index:
            $(that.suggestionsContainer).css({
                'max-height': options.maxHeight + 'px',
                'width': options.width + 'px',
                'z-index': options.zIndex
            });
        }

        private clearCache() {
            this.cachedResponse = {};
            this.badQueries = [];
        }

        private clear() {
            this.clearCache();
            this.currentValue = '';
            this.suggestions = [];
        }

        private disable() {
            let that = this;
            that.disabled = true;
            clearInterval(that.onChangeInterval);
            that.abortAjax();
        }

        private enable() {
            this.disabled = false;
        }

        private fixPosition() {
            // Use only when container has already its content

            let that = this,
                $container = $(that.suggestionsContainer),
                containerParent = $container.parent().get(0);
            // Fix position automatically when appended to body.
            // In other cases force parameter must be given.
            if (containerParent !== document.body && !that.options.forceFixPosition) {
                return;
            }

            // Choose orientation
            let orientation = that.options.orientation,
                containerHeight = $container.outerHeight(),
                height = that.el.outerHeight(),
                offset = that.el.offset(),
                styles = { 'top': offset.top, 'left': offset.left, 'width': null };

            if (orientation === 'auto') {
                let viewPortHeight = $(window).height(),
                    scrollTop = $(window).scrollTop(),
                    topOverflow = -scrollTop + offset.top - containerHeight,
                    bottomOverflow = scrollTop + viewPortHeight - (offset.top + height + containerHeight);

                orientation = (Math.max(topOverflow, bottomOverflow) === topOverflow) ? 'top' : 'bottom';
            }

            if (orientation === 'top') {
                styles.top += -containerHeight;
            } else {
                styles.top += height;
            }

            // If container is not positioned to body,
            // correct its position using offset parent offset
            if (containerParent !== document.body) {
                let opacity = $container.css('opacity'),
                    parentOffsetDiff;

                if (!that.visible) {
                    $container.css('opacity', 0).show();
                }

                parentOffsetDiff = $container.offsetParent().offset();
                styles.top -= parentOffsetDiff.top;
                styles.left -= parentOffsetDiff.left;

                if (!that.visible) {
                    $container.css('opacity', opacity).hide();
                }
            }

            if (that.options.width === 'auto') {
                styles.width = that.el.outerWidth() + 'px';
            }

            $container.css(styles);
        }

        private enableKillerFn() {
            let that = this;
            $(document).on("click.autocomplete", that.killerFn);
        }
  
        private disableKillerFn() {
            let that = this;
            $(document).off("click.autocomplete", that.killerFn);
        }

        private killSuggestions() {
            let that = this;
            that.stopKillSuggestions();
            that.intervalId = window.setInterval(function () {
                if (that.visible) {
                    // No need to restore value when 
                    // preserveInput === true, 
                    // because we did not change it
                    if (!that.options.preserveInput) {
                        that.el.val(that.currentValue);
                    }

                    that.hide();
                }

                that.stopKillSuggestions();
            }, 50);
        }

        private stopKillSuggestions() {
            window.clearInterval(this.intervalId);
        }

        private isCursorAtEnd() {
            let that = this,
                valLength = that.el.val().length,
                selectionStart = that.element.selectionStart,
                range;

            if (typeof selectionStart === 'number') {
                return selectionStart === valLength;
            }

            let documentSelection = document["selection"];
            if (documentSelection) {
                range = documentSelection.createRange();
                range.moveStart('character', -valLength);
                return valLength === range.text.length;
            }
            return true;
        }

        private onKeyPress(e: JQueryEventObject) {
            let that = this;

            // If suggestions are hidden and user presses arrow down, display suggestions:
            if (!that.disabled && !that.visible && e.which === DbAutocomplete.keys.DOWN && that.currentValue) {
                that.suggest();
                return;
            }

            if (that.disabled || !that.visible) {
                return;
            }

            switch (e.which) {
                case DbAutocomplete.keys.ESC:
                    that.el.val(that.currentValue);
                    that.hide();
                    break;
                case DbAutocomplete.keys.RIGHT:
                    if (that.hint && that.options.onHint && that.isCursorAtEnd()) {
                        that.selectHint();
                        break;
                    }
                    return;
                case DbAutocomplete.keys.TAB:
                    if (that.hint && that.options.onHint) {
                        that.selectHint();
                        return;
                    }
                    if (that.selectedIndex === -1) {
                        that.hide();
                        return;
                    }
                    that.select(that.selectedIndex);
                    if (that.options.tabDisabled === false) {
                        return;
                    }
                    break;
                case DbAutocomplete.keys.RETURN:
                    if (that.selectedIndex === -1) {
                        that.hide();
                        return;
                    }
                    that.select(that.selectedIndex);
                    break;
                case DbAutocomplete.keys.UP:
                    that.moveUp();
                    break;
                case DbAutocomplete.keys.DOWN:
                    that.moveDown();
                    break;
                default:
                    return;
            }

            // Cancel event if function did not return:
            e.stopImmediatePropagation();
            e.preventDefault();
        }

        private onKeyUp(e: JQueryEventObject) {
            let that = this;

            if (that.disabled) {
                return;
            }

            switch (e.which) {
                case DbAutocomplete.keys.UP:
                case DbAutocomplete.keys.DOWN:
                    return;
            }

            clearInterval(that.onChangeInterval);

            if (that.currentValue !== that.el.val()) {
                that.findBestHint();
                if (that.options.deferRequestBy > 0) {
                    // Defer lookup in case when value changes very quickly:
                    that.onChangeInterval = setInterval(function () {
                        that.onValueChange();
                    }, that.options.deferRequestBy);
                } else {
                    that.onValueChange();
                }
            }
        }

        private onValueChange() {
            let that = this,
                options = that.options,
                value = that.el.val(),
                query = that.getQuery(value);

            if (that.selection && that.currentValue !== query) {
                that.selection = null;
                (options.onInvalidateSelection || $.noop).call(that.element);
            }

            clearInterval(that.onChangeInterval);
            that.currentValue = value;
            that.selectedIndex = -1;

            // Check existing suggestion for the match before proceeding:
            if (options.triggerSelectOnValidInput && that.isExactMatch(query)) {
                that.select(0);
                return;
            }

            if (query.length < options.minChars) {
                that.hide();
            } else {
                that.getSuggestions(query);
            }
        }

        private isExactMatch(query: string) {
            let suggestions = this.suggestions;

            return (suggestions.length === 1 && suggestions[0].value.toLowerCase() === query.toLowerCase());
        }

        private getQuery(value: string) {
            let delimiter = this.options.delimiter,
                parts;

            if (!delimiter) {
                return value;
            }
            parts = value.split(<string>delimiter);
            return $.trim(parts[parts.length - 1]);
        }

        private getSuggestionsLocal(query: string) {
            let that = this,
                options = that.options,
                queryLowerCase = query.toLowerCase(),
                filter = options.lookupFilter,
                limit = parseInt(<any>options.lookupLimit, 10),
                data;

            let lookUpSuggestions: DbAutocompleteSuggestion[] = <any>options.lookup;
            data = {
                suggestions: $.grep(lookUpSuggestions, function (suggestion) {
                    return filter(suggestion, query, queryLowerCase);
                })
            };

            if (limit && data.suggestions.length > limit) {
                data.suggestions = data.suggestions.slice(0, limit);
            }

            return data;
        }

        private getSuggestions(q: string) {
            let response,
                that = this,
                options = that.options,
                serviceUrl = options.serviceUrl,
                params,
                cacheKey,
                ajaxSettings;

            options.params[options.paramName] = q;
            params = options.ignoreParams ? null : options.params;

            if (options.onSearchStart.call(that.element, options.params) === false) {
                return;
            }

            if ($.isFunction(options.lookup)) {
                options.lookup(q, function (data) {
                    that.suggestions = data.suggestions;
                    that.suggest();
                    options.onSearchComplete.call(that.element, q, data.suggestions);
                });
                return;
            }

            if (that.isLocal) {
                response = that.getSuggestionsLocal(q);
            } else {
                if ($.isFunction(serviceUrl)) {
                    let serviceUrlFunc = <Function><any>serviceUrl;
                    serviceUrl = serviceUrlFunc.call(that.element, q);
                }
                cacheKey = serviceUrl + '?' + $.param(params || {});
                response = that.cachedResponse[cacheKey];
            }

            if (response && $.isArray(response.suggestions)) {
                that.suggestions = response.suggestions;
                that.suggest();
                options.onSearchComplete.call(that.element, q, response.suggestions);
            } else if (!that.isBadQuery(q)) {
                that.abortAjax();

                ajaxSettings = {
                    url: serviceUrl,
                    data: params,
                    type: options.type,
                    dataType: options.dataType
                };

                $.extend(ajaxSettings, options.ajaxSettings);

                that.currentRequest = $.ajax(ajaxSettings).then(function (data) {
                    let result;
                    that.currentRequest = null;
                    result = options.transformResult(data, q);
                    that.processResponse(result, q, cacheKey);
                    options.onSearchComplete.call(that.element, q, result.suggestions);
                }).fail(function (jqXHR, textStatus, errorThrown) {
                    options.onSearchError.call(that.element, q, jqXHR, textStatus, errorThrown);
                });
            } else {
                options.onSearchComplete.call(that.element, q, []);
            }
        }

        private isBadQuery(q: string) {
            if (!this.options.preventBadQueries) {
                return false;
            }

            let badQueries = this.badQueries,
                i = badQueries.length;

            while (i--) {
                if (q.indexOf(badQueries[i]) === 0) {
                    return true;
                }
            }

            return false;
        }

        private hide() {
            let that = this,
                container = $(that.suggestionsContainer);

            if ($.isFunction(that.options.onHide) && that.visible) {
                that.options.onHide.call(that.element, container);
            }

            that.visible = false;
            that.selectedIndex = -1;
            clearInterval(that.onChangeInterval);
            $(that.suggestionsContainer).hide();
            that.signalHint(null);
        }

        private suggest() {
            if (!this.suggestions.length) {
                if (this.options.showNoSuggestionNotice) {
                    this.noSuggestions();
                } else {
                    this.hide();
                }
                return;
            }

            let that = this,
                options = that.options,
                groupBy = options.groupBy,
                formatResult = options.formatResult,
                value = that.getQuery(that.currentValue),
                className = that.classes.suggestion,
                classSelected = that.classes.selected,
                container = $(that.suggestionsContainer),
                noSuggestionsContainer = $(that.noSuggestionsContainer),
                beforeRender = options.beforeRender,
                html = '',
                category,
                formatGroup = function (suggestion, currentValue, index: number) {
                    let currentCategory = suggestion.data[groupBy];

                    if (category === currentCategory) {
                        return '';
                    }

                    category = currentCategory;

                    return '<div class="autocomplete-group"><strong>' + category + '</strong></div>';
                };

            if (options.triggerSelectOnValidInput && that.isExactMatch(value)) {
                that.select(0);
                return;
            }

            // Build suggestions inner HTML:
            $.each(that.suggestions, function (i, suggestion) {
                if (groupBy) {
                    html += formatGroup(suggestion, value, i);
                }

                html += '<div class="' + className + '" data-index="' + i + '">' + formatResult(suggestion, value) + '</div>';
            });

            this.adjustContainerWidth();

            noSuggestionsContainer.detach();
            container.html(html);

            if ($.isFunction(beforeRender)) {
                beforeRender.call(that.element, container, that.suggestions);
            }

            that.fixPosition();
            container.show();

            // Select first value by default:
            if (options.autoSelectFirst) {
                that.selectedIndex = 0;
                container.scrollTop(0);
                container.children('.' + className).first().addClass(classSelected);
            }

            that.visible = true;
            that.findBestHint();
        }

        private noSuggestions() {
            let that = this,
                container = $(that.suggestionsContainer),
                noSuggestionsContainer = $(that.noSuggestionsContainer);

            this.adjustContainerWidth();

            // Some explicit steps. Be careful here as it easy to get
            // noSuggestionsContainer removed from DOM if not detached properly.
            noSuggestionsContainer.detach();
            container.empty(); // clean suggestions if any
            container.append(noSuggestionsContainer);

            that.fixPosition();

            container.show();
            that.visible = true;
        }

        private adjustContainerWidth() {
            let that = this,
                options = that.options,
                width,
                container = $(that.suggestionsContainer);

            // If width is auto, adjust width before displaying suggestions,
            // because if instance was created before input had width, it will be zero.
            // Also it adjusts if input width has changed.
            if (options.width === 'auto') {
                width = that.el.outerWidth();
                container.css('width', width > 0 ? width : 300);
            }
        }

        private findBestHint() {
            let that = this,
                value = that.el.val().toLowerCase(),
                bestMatch = null;

            if (!value) {
                return;
            }

            $.each(that.suggestions, function (i, suggestion) {
                let foundMatch = suggestion.value.toLowerCase().indexOf(value) === 0;
                if (foundMatch) {
                    bestMatch = suggestion;
                }
                return !foundMatch;
            });

            that.signalHint(bestMatch);
        }

        private signalHint(suggestion: DbAutocompleteSuggestion) {
            let hintValue = '',
                that = this;
            if (suggestion) {
                hintValue = that.currentValue + suggestion.value.substr(that.currentValue.length);
            }
            if (that.hintValue !== hintValue) {
                that.hintValue = hintValue;
                that.hint = suggestion;
                (this.options.onHint || $.noop)(hintValue);
            }
        }

        private verifySuggestionsFormat(suggestions) {
            // If suggestions is string array, convert them to supported format:
            if (suggestions.length && typeof suggestions[0] === 'string') {
                return $.map(suggestions, function (value) {
                    return { value: value, data: null };
                });
            }

            return suggestions;
        }

        private validateOrientation(orientation: string, fallback: "bottom" | "auto" | "top"): "bottom" | "auto" | "top" {
            orientation = $.trim(orientation || '').toLowerCase();

            if ($.inArray(orientation, ['auto', 'bottom', 'top']) === -1) {
                orientation = fallback;
            }

            return <any>orientation;
        }

        private processResponse(result: DbAutocompleteResponse, originalQuery: string, cacheKey: string) {
            let that = this,
                options = that.options;

            result.suggestions = that.verifySuggestionsFormat(result.suggestions);

            // Cache results if cache is not disabled:
            if (!options.noCache) {
                that.cachedResponse[cacheKey] = result;
                if (options.preventBadQueries && !result.suggestions.length) {
                    that.badQueries.push(originalQuery);
                }
            }

            // Return if originalQuery is not matching current query:
            if (originalQuery !== that.getQuery(that.currentValue)) {
                return;
            }

            that.suggestions = result.suggestions;
            that.suggest();
        }

        private activate(index: number) {
            let that = this,
                activeItem,
                selected = that.classes.selected,
                container = $(that.suggestionsContainer),
                children = container.find('.' + that.classes.suggestion);

            container.find('.' + selected).removeClass(selected);

            that.selectedIndex = index;

            if (that.selectedIndex !== -1 && children.length > that.selectedIndex) {
                activeItem = children.get(that.selectedIndex);
                $(activeItem).addClass(selected);
                return activeItem;
            }

            return null;
        }

        private selectHint() {
            let that = this,
                i = $.inArray(that.hint, that.suggestions);

            that.select(i);
        }

        private select(index: number) {
            let that = this;
            that.hide();
            that.onSelect(index);
            that.disableKillerFn();
        }

        private moveUp() {
            let that = this;

            if (that.selectedIndex === -1) {
                return;
            }

            if (that.selectedIndex === 0) {
                $(that.suggestionsContainer).children().first().removeClass(that.classes.selected);
                that.selectedIndex = -1;
                that.el.val(that.currentValue);
                that.findBestHint();
                return;
            }

            that.adjustScroll(that.selectedIndex - 1);
        }

        private moveDown() {
            let that = this;

            if (that.selectedIndex === (that.suggestions.length - 1)) {
                return;
            }

            that.adjustScroll(that.selectedIndex + 1);
        }

        private adjustScroll(index: number) {
            let that = this,
                activeItem = that.activate(index);

            if (!activeItem) {
                return;
            }

            let offsetTop,
                upperBound,
                lowerBound,
                heightDelta = $(activeItem).outerHeight();

            offsetTop = activeItem.offsetTop;
            upperBound = $(that.suggestionsContainer).scrollTop();
            lowerBound = upperBound + that.options.maxHeight - heightDelta;

            if (offsetTop < upperBound) {
                $(that.suggestionsContainer).scrollTop(offsetTop);
            } else if (offsetTop > lowerBound) {
                $(that.suggestionsContainer).scrollTop(offsetTop - that.options.maxHeight + heightDelta);
            }

            if (!that.options.preserveInput) {
                that.el.val(that.getValue(that.suggestions[index].value));
            }
            that.signalHint(null);
        }

        private onSelect(index: number) {
            let that = this,
                onSelectCallback = that.options.onSelect,
                suggestion = that.suggestions[index];

            that.currentValue = that.getValue(suggestion.value);

            if (that.currentValue !== that.el.val() && !that.options.preserveInput) {
                that.el.val(that.currentValue);
            }

            that.signalHint(null);
            that.suggestions = [];
            that.selection = suggestion;

            if ($.isFunction(onSelectCallback)) {
                onSelectCallback.call(that.element, suggestion);
            }
        }

        private getValue(value: string) {
            let that = this,
                delimiter = that.options.delimiter,
                currentValue,
                parts;

            if (!delimiter) {
                return value;
            }

            currentValue = that.currentValue;
            parts = currentValue.split(delimiter);

            if (parts.length === 1) {
                return value;
            }

            return currentValue.substr(0, currentValue.length - parts[parts.length - 1].length) + value;
        }

        public dispose() {
            let that = this;
            that.el.off('.autocomplete').removeData('autocomplete');
            that.disableKillerFn();
            $(window).off('resize.autocomplete', that.fixPositionCapture);
            $(that.suggestionsContainer).remove();
        }

        private static formatResult(suggestion: DbAutocompleteSuggestion, currentValue: string) {
            // Do not replace anything if there current value is empty
            if (!currentValue) {
                return suggestion.value;
            }

            let pattern = '(' + DbAutocompleteUtils.escapeRegExChars(currentValue) + ')';

            return suggestion.value
                .replace(new RegExp(pattern, 'gi'), '<strong>$1<\/strong>')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/&lt;(\/?strong)&gt;/g, '<$1>');
        }
    }

    class DbAutocompleteUtils {
        public static escapeRegExChars(value: string) {
            return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
        }

        public static createNode(containerClass: string) {
            let div = document.createElement('div');
            div.className = containerClass;
            div.style.position = 'absolute';
            div.style.display = 'none';
            return div;
        }
    }
  
    // Create chainable jQuery plugin:
    $.fn.dbAutocomplete = function (options: string, args) {
        let dataKey = 'autocomplete';
        // If function invoked without argument return
        // instance of the first matched element:
        if (!arguments.length) {
            return this.first().data(dataKey);
        }

        return this.each(function () {
            let inputElement = $(this),
                instance: DbAutocomplete = inputElement.data(dataKey);

            if (typeof options === 'string') {
                if (instance && typeof instance[options] === 'function') {
                    instance[options](args);
                }
            } else {
                // If instance already exists, destroy it:
                if (instance && instance.dispose) {
                    instance.dispose();
                }
                instance = new DbAutocomplete(this, options);
                inputElement.data(dataKey, instance);
            }
        });
    };
})();