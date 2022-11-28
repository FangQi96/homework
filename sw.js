const CACHE_NAME = 'homework';

self.addEventListener('fetch', function(event) {
    const createResPromise = async () => {
      // self.caches is global variable, could be accessed by caches, returns the cacheStorage
      const cachedResponse = await caches.match(event.request);

      if (cachedResponse) {
        console.log('service worker cache hit');
        return cachedResponse;
      }

      // cache.put function will consume request&response objects at the same time (They are stream)
      // fetch will consume request object

      // Clone request for later usage
      const fetchRequest = event.request.clone();
      const fetchResponse = await fetch(fetchRequest);

      // Don't satisfy the condition of caching, DO NOT put it into caches
      if (!fetchResponse || fetchResponse.status !== 200) {
        return fetchResponse;
      }

      // Clone response object for return to use
      const toCacheResponse = fetchResponse.clone();
      // Put the response into caches
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(event.request, toCacheResponse);
      });

      // Return the valid response object
      return fetchResponse;
    };

    // event.respondWith asks for a Promise instance
    const p = createResPromise();
    event.respondWith(p);
  });