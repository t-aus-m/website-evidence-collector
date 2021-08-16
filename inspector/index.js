const groupBy = require("lodash/groupBy");
const flatten = require("lodash/flatten");

async function inspector(args, logger, pageSession, output) {
  const c = {
    eventData: null,
    logger: logger,
    args: args,
    output: output,
    pageSession: pageSession,
  };

  let event_data_all = await new Promise((resolve, reject) => {
    logger.query(
      {
        start: 0,
        order: "desc",
        limit: Infinity,
      },
      (err, results) => {
        if (err) return reject(err);
        return resolve(results.file);
      }
    );
  });

  // filter only events with type set
  c.eventData = event_data_all.filter((event) => {
    return !!event.type;
  });

  c.inspectCookies = async function () {
    let cookies_from_events = flatten(
      c.eventData
        .filter((event) => {
          return event.type.startsWith("Cookie");
        })
        .map((event) => {
          event.data.forEach((cookie) => {
            cookie.log = {
              stack: event.stack,
              type: event.type,
              timestamp: event.timestamp,
              location: event.location,
            };
          });
          return event.data;
        })
    );

    c.output.cookies.forEach((cookie) => {
      let matched_event = cookies_from_events.find((cookie_from_events) => {
        return (
          cookie.name == cookie_from_events.key &&
          cookie.domain == cookie_from_events.domain &&
          cookie.path == cookie_from_events.path
        );
      });

      if (!!matched_event) {
        cookie.log = matched_event.log;
      }

      if (
        isFirstParty(
          page_session.refs_regexp,
          `cookie://${cookie.domain}${cookie.path}`
        )
      ) {
        cookie.firstPartyStorage = true;
        c.pageSession.hosts.cookies.firstParty.add(cookie.domain);
      } else {
        cookie.firstPartyStorage = false;
        c.pageSession.hosts.cookies.thirdParty.add(cookie.domain);
      }
    });

    output.cookies = output.cookies.sort(function (a, b) {
      return b.expires - a.expires;
    });
  };

  c.inspectLocalStorage = async function () {
    let storage_from_events = c.eventData.filter((event) => {
      return event.type.startsWith("Storage");
    });

    Object.keys(c.output.localStorage).forEach((origin) => {
      let hostname = new url.URL(origin).hostname;
      let isFirstPartyStorage = isFirstParty(c.pageSession.refs_regexp, origin);

      if (isFirstPartyStorage) {
        c.pageSession.hosts.localStorage.firstParty.add(hostname);
      } else {
        c.pageSession.hosts.localStorage.thirdParty.add(hostname);
      }

      //
      let originStorage = c.output.localStorage[origin];
      Object.keys(originStorage).forEach((key) => {
        // add if entry is linked to first-party host
        originStorage[key].firstPartyStorage = isFirstPartyStorage;
        // find log for a given key
        let matched_event = storage_from_events.find((event) => {
          return (
            origin == event.origin && Object.keys(event.data).includes(key)
          );
        });

        if (!!matched_event) {
          originStorage[key].log = {
            stack: matched_event.stack,
            type: matched_event.type,
            timestamp: matched_event.timestamp,
            location: matched_event.location,
          };
        }
      });
    });
  };

  c.inspectBeacons = async function () {
    let beacons_from_events = flatten(
      c.eventData
        .filter((event) => {
          return event.type.startsWith("Request.Tracking");
        })
        .map((event) => {
          return Object.assign({}, event.data, {
            log: {
              stack: event.stack,
              // type: event.type,
              timestamp: event.timestamp,
            },
          });
        })
    );

    for (const beacon of beacons_from_events) {
      const l = url.parse(beacon.url);

      if (beacon.listName == "easyprivacy.txt") {
        if (isFirstParty(c.pageSession.refs_regexp, l)) {
          c.pageSession.hosts.beacons.firstParty.add(l.hostname);
        } else {
          c.pageSession.hosts.beacons.thirdParty.add(l.hostname);
        }
      }
    }

    // make now a summary for the beacons (one of every hostname+pathname and their occurrance)
    let beacons_from_events_grouped = groupBy(beacons_from_events, (beacon) => {
      let url_parsed = url.parse(beacon.url);
      return `${url_parsed.hostname}${url_parsed.pathname.replace(/\/$/, "")}`;
    });

    let beacons_summary = [];
    for (const [key, beacon_group] of Object.entries(
      beacons_from_events_grouped
    )) {
      beacons_summary.push(
        Object.assign({}, beacon_group[0], {
          occurrances: beacon_group.length,
        })
      );
    }

    beacons_summary.sort((b1, b2) => {
      return b2.occurances - b1.occurances;
    });

    c.output.beacons = beacons_summary;
  };

  c.inspectHosts = async function () {
    // Hosts Inspection
    let arrayFromParties = function (array) {
      return {
        firstParty: Array.from(array.firstParty),
        thirdParty: Array.from(array.thirdParty),
      };
    };

    c.output.hosts = {
      requests: arrayFromParties(c.pageSession.hosts.requests),
      beacons: arrayFromParties(c.pageSession.hosts.beacons),
      cookies: arrayFromParties(c.pageSession.hosts.cookies),
      localStorage: arrayFromParties(c.pageSession.hosts.localStorage),
      links: arrayFromParties(c.pageSession.hosts.links),
    };
  };

  return c;
}

module.exports = inspector;