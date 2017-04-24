/***
 * DONE: Reduce layout processing on data insert
 * DONE: Add notify data set changed and notify data insert option in data source
 * DONE: Add on end reached callback
 * DONE: Make another class for render stack generator
 * DONE: Simplify rendering a loading footer
 * DONE: Anchor first visible index on any insert/delete data wise
 * DONE: Build Scroll to index
 * DONE: Give viewability callbacks
 * DONE: Add full render logic in cases like change of dimensions
 * DONE: Fix all proptypes
 * DONE: Add Initial render Index support
 * TODO: Heavily reduce isHorizontal checks
 */
import React, {Component} from "react";
import Messages from "./messages/Messages";
import VirtualRenderer from "./VirtualRenderer";
import DataProvider from "./dependencies/DataProvider";
import LayoutProvider from "./dependencies/LayoutProvider";
import LayoutManager from "./layoutmanager/LayoutManager";

let ScrollComponent, ViewHolder;

if (navigator && navigator.product == "ReactNative") {
    ScrollComponent = require("./scrollcomponent/reactnative/ScrollComponent");
    ViewHolder = require("./viewholder/reactnative/ViewHolder");
}
else {
    ScrollComponent = require("./scrollcomponent/web/ScrollComponent").default;
    ViewHolder = require("./viewholder/web/ViewHolder").default;
}

class RecyclerListView extends Component {
    constructor(args) {
        super(args);
        this._onScroll = this._onScroll.bind(this);
        this._onSizeChanged = this._onSizeChanged.bind(this);
        this._onVisibleItemsChanged = this._onVisibleItemsChanged.bind(this);
        this.scrollToOffset = this.scrollToOffset.bind(this);
        this._onEndReachedCalled = false;
        this._virtualRenderer = null;
        this._initComplete = false;
        this._relayoutReqIndex = -1;
        this._params = {};
        this._layout = {height: 0, width: 0};
        this._pendingScrollToOffset = null;
        this._tempDim = {};
        this.state = {
            renderStack: []
        };
    }

    componentWillReceiveProps(newProps) {
        this._checkAndChangeLayouts(newProps);
        if (!this.props.onVisibleItemsChanged) {
            this._virtualRenderer.removeVisibleItemsListener();
        }
        else {
            this._virtualRenderer.attachVisibleItemsListener(this._onVisibleItemsChanged);
        }
    }


    componentDidUpdate() {
        if (this._pendingScrollToOffset) {
            let offset = this._pendingScrollToOffset;
            this._pendingScrollToOffset = null;
            if (this.props.isHorizontal) {
                offset.y = 0;
            } else {
                offset.x = 0;
            }
            setTimeout(() => {
                this.scrollToOffset(offset.x, offset.y, false);
            }, 0);
        }
        this._processOnEndReached();
        this._checkAndChangeLayouts(this.props);
    }

    scrollToIndex(index, animate) {
        let offsets = this._virtualRenderer.getLayoutManager().getOffsetForIndex(index);
        this.scrollToOffset(offsets.x, offsets.y, animate);
    }

    scrollToItem(data, animate) {
        let count = this.props.dataProvider.getSize();
        for (let i = 0; i < count; i++) {
            if (this.props.dataProvider.getDataForIndex(i) === data) {
                this.scrollToIndex(i, animate);
                break;
            }
        }
    }

    scrollToTop(animate) {
        this.scrollToOffset(0, 0, animate);
    }

    scrollToEnd(animate) {
        let lastIndex = this.props.dataProvider.getSize() - 1;
        this.scrollToIndex(lastIndex, animate);
    }

    scrollToOffset(x, y, animate = false) {
        this.refs["scrollComponent"].scrollTo(x, y, animate);
    }

    getCurrentScrollOffset() {
        let offset = this._virtualRenderer.getViewabilityTracker().getLastOffset();
        return this.props.isHorizontal ? offset.x : offset.y;
    }

    findApproxFirstVisibleIndex() {
        return this._virtualRenderer.getViewabilityTracker().findFirstLogicallyVisibleIndex();
    }

    _checkAndChangeLayouts(newProps, forceFullRender) {
        this._params.isHorizontal = newProps.isHorizontal;
        this._params.itemCount = newProps.dataProvider.getSize();
        this._virtualRenderer.setParamsAndDimensions(this._params, this._layout);
        if (forceFullRender || this.props.layoutProvider !== newProps.layoutProvider || this.props.isHorizontal !== newProps.isHorizontal) {
            //TODO:Talha use old layout manager
            this._virtualRenderer.setLayoutManager(new LayoutManager(newProps.layoutProvider, this._layout, newProps.isHorizontal));
            this._virtualRenderer.refreshWithAnchor();
        } else if (this.props.dataProvider !== newProps.dataProvider) {
            this._virtualRenderer.getLayoutManager().reLayoutFromIndex(newProps.dataProvider._firstIndexToProcess, newProps.dataProvider.getSize());
            this._virtualRenderer.refresh();
        } else if (this._relayoutReqIndex >= 0) {
            this._virtualRenderer.getLayoutManager().reLayoutFromIndex(this._relayoutReqIndex, newProps.dataProvider.getSize());
            this._relayoutReqIndex = -1;
            this._virtualRenderer.refresh();
            //TODO:Talha Test this out
            this.setState((prevState, props) => {
                return prevState;
            });
        }
    }

    _onSizeChanged(layout) {
        this._layout.height = layout.height;
        this._layout.width = layout.width;
        if (layout.height === 0 || layout.width === 0) {
            throw "RecyclerListView needs to have a bounded size. Currently height or, width is 0";
        }
        if (!this._initComplete) {
            this._initComplete = true;
            this._initTrackers();
            this._processOnEndReached();
        }
        else {
            this._checkAndChangeLayouts(this.props, true);
        }
    }

    _initTrackers() {
        this._assertDependencyPresence();
        this._virtualRenderer = new VirtualRenderer((stack) => {
            this.setState((prevState, props) => {
                return {renderStack: stack};
            });
        }, (offset) => {
            this._pendingScrollToOffset = offset;
        });
        if (this.props.onVisibleItemsChanged) {
            this._virtualRenderer.attachVisibleItemsListener(this._onVisibleItemsChanged);
        }
        this._virtualRenderer.setParamsAndDimensions({
            isHorizontal: this.props.isHorizontal,
            itemCount: this.props.dataProvider.getSize(),
            initialOffset: this.props.initialOffset,
            renderAheadOffset: this.props.renderAheadOffset,
            initialRenderIndex: this.props.initialRenderIndex
        }, this._layout);
        this._virtualRenderer.setLayoutManager(new LayoutManager(this.props.layoutProvider, this._layout, this.props.isHorizontal));
        this._virtualRenderer.setLayoutProvider(this.props.layoutProvider);
        this._virtualRenderer.init();
    }

    _onVisibleItemsChanged(all, now, notNow) {
        this.props.onVisibleItemsChanged(all, now, notNow);

    }

    _assertDependencyPresence() {
        if (!this.props.dataProvider || !this.props.layoutProvider) {
            throw Messages.ERROR_LISTVIEW_VALIDATION;
        }
    }

    _renderRowUsingMeta(itemMeta) {
        let itemRect = this._virtualRenderer.getLayoutManager().getLayouts()[itemMeta.dataIndex];
        let data = this.props.dataProvider.getDataForIndex(itemMeta.dataIndex);
        //TODO:Talha remove this
        let dataTest = {data: data, key: itemMeta.key};
        let type = this.props.layoutProvider.getLayoutTypeForIndex(itemMeta.dataIndex);
        this._checkExpectedDimensionDiscrepancy(itemRect, type, itemMeta.dataIndex);
        return (
            <ViewHolder key={itemMeta.key} x={itemRect.x} y={itemRect.y} height={itemRect.height}
                        width={itemRect.width}>
                {this.props.rowRenderer(type, dataTest)}
            </ViewHolder>
        );
    }

    _checkExpectedDimensionDiscrepancy(itemRect, type, index) {
        this.props.layoutProvider.setLayoutForType(type, this._tempDim);
        if (itemRect.height !== this._tempDim.height || itemRect.width !== this._tempDim.width) {
            if (this._relayoutReqIndex === -1) {
                this._relayoutReqIndex = index;
            } else {
                this._relayoutReqIndex = Math.min(this._relayoutReqIndex, index);
            }
        }
    }

    _generateRenderStack() {
        let count = this.state.renderStack.length;
        let renderedItems = [];
        for (let i = 0; i < count; i++) {
            renderedItems.push(this._renderRowUsingMeta(this.state.renderStack[i]));
        }
        return renderedItems;
    }

    _onScroll(offsetX, offsetY, rawEvent) {
        this._virtualRenderer.updateOffset(offsetX, offsetY);
        if (this.props.onScroll) {
            this.props.onScroll(rawEvent);
        }
        this._processOnEndReached();
    }

    _processOnEndReached() {
        if (this.props.onEndReached && this._virtualRenderer) {
            let layout = this._virtualRenderer.getLayoutDimension();
            let windowBound = this.props.isHorizontal ? layout.width - this._layout.width : layout.height - this._layout.height;
            if (windowBound - this._virtualRenderer.getViewabilityTracker().getLastOffset() <= this.props.onEndReachedThreshold) {
                if (!this._onEndReachedCalled) {
                    this._onEndReachedCalled = true;
                    this.props.onEndReached();
                }
            }
            else {
                this._onEndReachedCalled = false;
            }
        }
    }


    render() {
        return (
            this._virtualRenderer ?
                <ScrollComponent ref="scrollComponent" initialOffset={this.props.initialOffset} parentProps={this.props}
                                 onScroll={this._onScroll} isHorizontal={this.props.isHorizontal}
                                 onSizeChanged={this._onSizeChanged} renderFooter={this.props.renderFooter}
                                 contentHeight={this._virtualRenderer.getLayoutDimension().height}
                                 contentWidth={this._virtualRenderer.getLayoutDimension().width}>
                    {this._generateRenderStack()}
                </ScrollComponent> :
                <ScrollComponent ref="scrollComponent" parentProps={this.props}
                                 onSizeChanged={this._onSizeChanged}></ScrollComponent>

        );
    }
}

export default RecyclerListView;

RecyclerListView
    .defaultProps = {
    initialOffset: 0,
    isHorizontal: false,
    renderAheadOffset: 250,
    onEndReachedThreshold: 0,
    initialRenderIndex: 0
};

//#if [DEV]
RecyclerListView
    .propTypes = {
    layoutProvider: React.PropTypes.instanceOf(LayoutProvider).isRequired,
    dataProvider: React.PropTypes.instanceOf(DataProvider).isRequired,
    rowRenderer: React.PropTypes.func.isRequired,
    initialOffset: React.PropTypes.number,
    renderAheadOffset: React.PropTypes.number,
    isHorizontal: React.PropTypes.bool,
    onScroll: React.PropTypes.func,
    onEndReached: React.PropTypes.func,
    onEndReachedThreshold: React.PropTypes.number,
    onVisibleIndexesChanged: React.PropTypes.func,
    renderFooter: React.PropTypes.func,
    initialRenderIndex: React.PropTypes.number
};
//#endif