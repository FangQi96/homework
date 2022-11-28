function debounce(fn, delay) {
  let timeout = null;
  return function () {
    if (timeout) {
      clearTimeout(timeout);
    }
    const that = this;
    timeout = setTimeout(() => {
      fn.apply(that, arguments);
    }, delay);
  };
}

const listData = [];
const LIST_SIZE = 10;
const FETCH_SIZE = 10;
const FETCHING_THRESHOLD = 2;
const DEFAULT_DOM_FACTOR = 3;
const DOM_REFRESH_THRESHOLD = 5;
const CACHE_NAME = 'homework';
let isFetching = false;
let mouseInList = false;
let currHighlightFeature = null;
let currStartIndex = 0;

require([
  'esri/config',
  'esri/Map',
  'esri/views/MapView',
  'esri/layers/FeatureLayer',
  "esri/core/reactiveUtils",
], (
  esriConfig,
  Map,
  MapView,
  FeatureLayer,
  reactiveUtils,
) => {
  esriConfig.apiKey = 'AAPK146b8d9ac3794160814c4e91742e889cIgppUvq6FcGCebVJ68m0oxqI-0aT-IOLFGIZsVuxYXCIInVEfaJCHolOv7IOcm1N';
  const listContainer = document.querySelector('.listContainer');
  const clearBtn = document.querySelector('.clearBtn');
  let listHeight = listContainer.offsetHeight;
  // Need to set the item height larger, so the list won't bouncing around at the end
  let itemHeight = Math.ceil(listHeight / LIST_SIZE);
  // Set the renderer on the feature layer
  const renderer = {
    type: 'simple',
    symbol: {
      type: 'simple-marker',
      style: 'circle',
      color: [50, 50, 50, 0.7],
      outline: {
        color: [255, 255, 255, 0.3],
        width: 0.2,
      },
      size: '8px',
    },

    // Define non-linear stops based on population scale
    visualVariables: [{
      type: 'size',
      field: 'pop2000',
      stops: [
        {
          value: 8000,
          size: 5,
        },
        {
          value: 80000,
          size: 15,
        },
        {
          value: 800000,
          size: 25,
        },
        {
          value: 8000000,
          size: 50,
        },
      ],
    }],

  };
  const featureLayer = new FeatureLayer({
    url: 'https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer/0',
    title: 'USA Layer',
    renderer,
  });

  const map = new Map({
    basemap: 'arcgis-topographic',
    layers: [featureLayer],
  });

  const view = new MapView({
    container: 'viewDiv',
    map,
    center: [-95, 38.5],
    constraints: {
      snapToZoom: false,
    },
    highlightOptions: {
      color: [255, 0, 0],
      fillOpacity: 0.9,
    },
    zoom: 8,
  });

  /**
   * Generate list DOM from data and height
   * @param  {attributes data from cache/server} originData
   * @param  {the DOM height of each list item} itemHeight
   * @return {list item DOM object}
   */
  const convertDataToDOM = (originData, itemHeight) => {
    const item = document.createElement('div');
    item.setAttribute('style', `height: ${itemHeight}px;`);
    item.setAttribute('objectid', originData.objectid);
    for (const key in originData) {
      const title = document.createElement('span');
      const inner = document.createElement('strong');
      // Prevent the span/strong element from triggering mouseover event
      title.setAttribute('style', 'pointer-events: none;');
      inner.setAttribute('style', 'pointer-events: none;');
      title.innerHTML = `${key}:`;
      inner.innerHTML = `${originData[key]}; `;
      item.appendChild(title);
      item.appendChild(inner);
    }
    return item;
  };

  /**
   * Refresh the list DOM, could discard all existing DOM nodes by passing enableCache = false
   * @param  {Whether re-used valid DOM nodes when scrolling} enableCache=true
   */
  const refreshListDOM = (enableCache = true) => {
    let listHeight = listContainer.offsetHeight;
    let itemHeight = Math.ceil(listHeight / LIST_SIZE);
    const scrollTop = Math.max(listContainer.scrollTop, 0);
    const startIndex = Math.max(Math.floor(scrollTop / itemHeight) - LIST_SIZE, 0);
    const endIndex = Math.min(startIndex + LIST_SIZE * DEFAULT_DOM_FACTOR, listData.length);
    const listContent = document.querySelector('#listContent');

    // When have enough data to scroll AND within safe scroll range
    if(startIndex - currStartIndex >= -DOM_REFRESH_THRESHOLD &&
      startIndex - currStartIndex <= DOM_REFRESH_THRESHOLD &&
      listData.length > DOM_REFRESH_THRESHOLD + LIST_SIZE &&
      enableCache) {
      return;
    }

    // Build DOM nodes from list data
    const viewData = listData.slice(startIndex, endIndex);
    listContent.innerHTML = '';
    for (let i = 0; i < viewData.length; i += 1) {
      const itemData = viewData[i];
      const item = convertDataToDOM(itemData, itemHeight);
      listContent.appendChild(item);
    }

    // Calculate corresponding padding-top & padding-bottom
    // So the scroll bar could be in correct place
    const paddingTop = startIndex * itemHeight;
    const paddingBottom = (listData.length - endIndex) * itemHeight;
    listContent.setAttribute('style', `padding-top: ${paddingTop}px; padding-bottom: ${paddingBottom}px`);
    currStartIndex = startIndex;
  };

  /**
   * Get ten more data from cache or server side
   * @param  {layerView object of current layer} layerView
   * @param  {Whether it's fetching the first screen data of the list} isFirstTime
   */
  const fetchListData = async (layerView, isFirstTime) => {
    try {
      isFetching = true;
      const usedEnv = isFirstTime ? 'View update' : 'Scroll';
      // When it's querying first screen data, reset the array, startIndex and scrollTop field
      if (isFirstTime) {
        listData.length = 0;
        listContainer.scrollTop = 0;
        currStartIndex = 0;
      }
      // Query all ids from client side
      const currentObjIds = await layerView.queryObjectIds({
        geometry: view.extent,
      });

      // Sort the objectid so we could use the cache better
      currentObjIds.sort((a, b) => a - b);

      const idsToQuery = [];
      // Get objectid array for querying
      for (let i = listData.length, count = 0;
        i < currentObjIds.length && count < FETCH_SIZE;
        i += 1, count += 1) {
        const objectId = currentObjIds[i].toString();
        idsToQuery.push(objectId);
      }

      // Query attributes from server side when cache missing
      if (idsToQuery.length > 0) {
        // Construct the where clause
        const whereSQL = `objectid in (${idsToQuery.toString()})`;
        const { features } = await featureLayer.queryFeatures({
          // Appoint where clause and fields(properties),
          // DO NOT pass extent since we want use cache
          where: whereSQL,
          outFields: ['objectid', 'areaname', 'st', 'capital', 'pop2000'],
        });
        for (const feature of features) {
          console.log(`[${usedEnv}] get data from response`);
          listData.push(feature.attributes);
        }
      }

      // When fetch new data, ignore the list cache and update DOMs anyway
      refreshListDOM(false);
      isFetching = false;
    } catch (err) {
      console.error('Something went wrong.', err);
    }
  };
  /**
   * Handler for virtual list scrolling
   */
  const handleListScroll = () => {
    if (!mouseInList) {
      // Prevent unwanted scroll callback when drag the map
      return;
    }

    // When scrollHeight - scrollTop - containerHeight < threshold
    // AND IS NOT FETCHING, load more data
    if (listContainer.scrollHeight - listContainer.scrollTop - listHeight < itemHeight * FETCHING_THRESHOLD && !isFetching) {
      console.log("fetching more data");
      view.whenLayerView(featureLayer).then((layerView) => {
        const isFirstTime = false;
        fetchListData(layerView, isFirstTime);
      });
    } else {
      // When not fetching new list data, refresh DOM manually
      refreshListDOM();
    }
  };

  const handleListLeaving = () => {
    mouseInList = false;
  };

  /**
   * Highlight the symbol when hovering on the list
   * @param  {event object} e
   */
  const handleListHover = (e) => {
    mouseInList = true;
    const objectId = e.target.getAttribute('objectid');
    if (objectId !== null && objectId !== undefined) {
      view.whenLayerView(featureLayer).then((layerView) => {
        layerView.queryFeatures({
          where: `objectid = ${objectId}`,
          returnGeometry: true,
        }).then((res) => {
          const feature = res.features[0];

          // If it's same feature as before, no more updating
          if (currHighlightFeature === feature.attributes.objectid) {
            return;
          }

          // Otherwise, highlight feature changed, remove previous feature
          if (currHighlightFeature) {
            currHighlightFeature.remove();
          }
          currHighlightFeature = layerView.highlight(
            feature.attributes.objectid,
          );
        });
      });
    }
  };

  /**
   * Handler for going to the clicked symbol
   * @param  {event object} e
   */
  const handleListItemClick = (e) => {
    // Go to the feature point when clicking
    const objectId = e.target.getAttribute('objectid');
    if (objectId !== null) {
      view.whenLayerView(featureLayer).then((layerView) => {
        layerView.queryFeatures({
          where: `objectid = ${objectId}`,
          returnGeometry: true,
        }).then((res) => {
          const feature = res.features[0];
          view.goTo(
            {
              target: feature.geometry,
            },
            {
              duration: 1000,
              easing: 'in-out-expo',
            },
          ).catch((err) => {
            console.error(err);
          });
        });
      });
    }
  };

  /**
   * Handler for clear cache button
   */
  const handleClear = () => {
    if ('serviceWorker' in navigator) {
      console.log('Found service work')
      caches.keys().then(function(cacheNames) {
        cacheNames.forEach(function(cacheName) {
          // Only delete the related cache
          if(cacheName === CACHE_NAME) {
            console.log(`Delete cache: ${cacheName}`)
            caches.delete(cacheName);
          }
        });
        console.log('Service worker caches deleted.');
        window.location.reload();
      });
    }
  };

  /**
   * Handler for window resize event, need to refresh DOM & update listHeight, itemHeight
   */
  const handleWindowResize = () => {
    refreshListDOM();
    // Update the list height and list item height
    listHeight = listContainer.offsetHeight;
    itemHeight = Math.ceil(listHeight / LIST_SIZE);
  }
  /**
   * Load service worker script
   */
  const serviceWorkerLoader = async () => {
    try {
      // Check whether service worker is supported
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/sw.js');
        console.log('Service worker registered');
      }
    } catch (e) {
      console.error('Service worker register failed', e);
    }
  };

  listContainer.addEventListener('scroll', debounce(handleListScroll, 300));
  listContainer.addEventListener('mouseover', handleListHover);
  listContainer.addEventListener('mouseout', handleListLeaving);
  listContainer.addEventListener('click', handleListItemClick);

  window.addEventListener('resize', debounce(handleWindowResize, 500));
  window.addEventListener('load', serviceWorkerLoader);

  clearBtn.addEventListener('click', handleClear);

  view.whenLayerView(featureLayer).then((layerView) => {
    // Initial data list fetching, only need to run once, so remove after finished
    const handler = layerView.watch('updating', (value) => {
      // Wait for the layer view to finish updating
      // This means we need to clear the list data
      if (!value && !mouseInList) {
        const isFirstTime = true;
        fetchListData(layerView, isFirstTime);
        handler.remove();
      }
    });

    // Watch extent changes
    reactiveUtils.watch(
      () => view.stationary,
      debounce(() => {
        if (view.extent && !mouseInList) {
          console.log("extent changed")
          const isFirstTime = true;
          fetchListData(layerView, isFirstTime);
        }
      }, 500)
    );
  });
});
