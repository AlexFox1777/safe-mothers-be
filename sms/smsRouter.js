const router = require("express").Router();
const Mothers = require("../mothers/mothersHelper");
const Drivers = require("../drivers/driversHelper");
const sms = require("./smsHelper");
const smsFunctions = require("./smsFunctions")
const Fuse = require("fuse.js");
const geo = require('../geolocation/geolib');
const moment = require('moment');


/****MOTHERS SMS INTERACTIONS****/
// 1 ---> HELP
router.get("/mothers/help/:phone_number", async (req, res) => {
  try {
    // get the phone number from the link
    let { phone_number } = req.params;

    // check if mother is registered
    let registered = await sms.checkMotherRegistration(phone_number);

    //if she is registered:
    if (registered && registered.length !== 0 && registered !== undefined) {
      let motherVillageId = registered[0].village;

      // search for the nearest driver by geoLocation()
      let drivers = await geo.geoLocation(motherVillageId);
      console.log("drivers", await drivers)
      let motherId = registered[0].id;
      let data = {
        mother_id: motherId,
        ended: null,
        completed: false,
        assigned: false,
        initiated:  moment().format(),
      
        //This will assign a driver and send a ride request message to that driver. Will change only if the driver does not respond or replies no.
        driver_id:drivers.id
      };
      console.log("Help",data)
      sms
        .addMotherRideRequest(data)
        .then(request => {
          /** Need to do the 5 minutes response time filter */
          let message = `${drivers.driver_name}, you have a pending pickup request id of  ${request}. To confirm type "yes/no pickupID" (example: yes 12)`;
          smsFunctions.sendDataToFrontlineSMS(message, drivers.phone);

          let messageForMother = `Request has been received. Waiting for boda response.`;
          smsFunctions.sendDataToFrontlineSMS(messageForMother, phone_number);
          console.log(message);
          console.log(messageForMother);
          res.status(200).json(request);
        })
        .catch(err => console.log(err));
    } else {
      //if mother is not registered, take her through a short registration process to gather he basic info: name, phone number, village:
      let message = `To register name please type 912 and your name. (example: 912 Abbo Zadzisai)`;
      smsFunctions.sendDataToFrontlineSMS(message, phone_number);
      console.log(message);
      res.status(200).json({ message: "Sent text message to mother" });
    }
  }
  catch (err) {
    console.log(err);
  }
});


// 2 ---> REGISTER Mother's Name
router.get("/mothers/register/name/:phone_number", async (req, res) => {
  try {
    let { answer } = req.query;
    let { phone_number } = req.params;

    let registered = await sms.checkMotherRegistration(phone_number);

    if (registered.length === 0 || registered === undefined) {
      let data = {
        name: answer,
        phone_number: phone_number
      };

      Mothers.addMother(data)
        .then(mother => {
          let message = `To register your village, type 913 and your village name. (Example: 913 Iganga)`;
          smsFunctions.sendDataToFrontlineSMS(message, phone_number);
          console.log(message);
          res.status(201).json(mother);
        })
        .catch(err => console.log(err));
    } else if (registered.length !== 0) {
      let message = `To register your village, type 913 and your village name. (Example: 913 Iganga)`;
      smsFunctions.sendDataToFrontlineSMS(message, phone_number);
      console.log(message);
    } else {
      let message = `Sorry, we can't process that. To register please type 912 and your name. (Example: 912 Abbo Zadzisai)`;
      smsFunctions.sendDataToFrontlineSMS(message, phone_number);
      console.log(message);
    }
  } catch (err) {
    res.status(500).json(err);
  }
});

// 3 ---> REGISTER Mother's Village Name
router.get("/mothers/register/villageName/:phone_number", async (req, res) => {
  try {
    let { phone_number } = req.params;
    let { answer } = req.query;

    let motherInfo = await sms.checkMotherRegistration(phone_number);
    let motherId = motherInfo[0].id;

    let villageList = await sms.getVillages();
    //fuse----> fuzzy search
    let options = {
      shouldSort: true,
      threshold: 0.6,
      location: 0,
      distance: 100,
      maxPatternLength: 32,
      minMatchCharLength: 1,
      keys: ["name"]
    };

    let fuse = new Fuse(villageList, options);

    let result = fuse.search(answer);
    // if the village name is spelled correctly and matches the villages in the database
    if (answer.toLowerCase() === result[0].name.toLowerCase()) {
      let mothers_data = {
        village: result[0].id,
        phone_number: phone_number
      };

      Mothers.updateMother(motherId, mothers_data)
        .then(mother => {
          let message =
            "You are now registered. Please text '911' to request a boda";
            smsFunctions.sendDataToFrontlineSMS(message, phone_number);
          res.status(201).json(mother);
        })
        .catch(err => {
          res.status(500).json(err);
        });
      // If village name does not match, give mother 4 village names that are close matches to pick from
    } else if (
      answer.toLowerCase() !== result[0].name.toLowerCase() &&
      result[0].name !== undefined
    ) {
      const newSuggestions = result.map(async suggestions => {
        if (suggestions !== undefined) {
          return suggestions;
        }
      });

      Promise.all(newSuggestions).then(infos => {
        let message2 = infos
          .slice(0, 4)
          .map(info => {
            return `${info.id} - "${info.name}"\n`;
          })
          .join(", ");

        let message =
          "Please press 914 and the number next to your village name: \n" + message2 + "\n(Example 914  5)";
        //send the information
        console.log(message);
        smsFunctions.sendDataToFrontlineSMS(message, phone_number);
        res.status(200).json({ message: "Message sent" });
      });
    } else if (result === undefined) {
      let message = `Sorry could not find village. Please try again ("Example: 913 Iganga") `;
      console.log(message);
    }
  } catch (err) {
    console.log(err);
    res.status(500).json(err);
  }
});

//MOTHERS VILLAGE SELECTION RESPONSE TO SMS
router.get("/mothers/selection", async (req, res) => {
  try {
    let { phone_number, answer } = req.query;

    let motherInfo = await sms.checkMotherRegistration(phone_number);
    let motherId = motherInfo[0].id;
    let villageId = parseInt(answer);

    let mother_data = {
      village: villageId
    };

    Mothers.updateMother(motherId, mother_data)
      .then(mother => {
        let message = `You are now registered! Please press 911 to call for a boda`;
        console.log(message);
        smsFunctions.sendDataToFrontlineSMS(message, phone_number);
        res.status(202).json(mother);
      })
      .catch(err => {
        console.log(err);
        res.status(500).json(err);
      });
  } catch (err) {
    console.log(err);
    res.status(500).json(err);
  }
});


/****DRIVERS SMS INTERACTIONS****/

// DRIVERS RESPONSE TO THE MESSAGE
router.post(
  "/drivers/assign/:phone_number/:answer/:request_id",
  async (req, res) => {
    try {
      let { answer, request_id, phone_number } = req.params;
      answer = answer.toLowerCase();
      request_id = parseInt(request_id);

      console.log('Driver',phone_number + answer + request_id);

      let newPhone = { phone: phone_number };
      
      let driverInfo = await sms.findDriverPhone(newPhone);
      
      let rideInfo = await sms.getRideByDriverId(driverInfo[0].id);
      //Getting the mother info to send to driver through sms
      let motherInfo = await Mothers.getMotherForDriver(rideInfo[0].mother_id);
      let villageId = { id: motherInfo[0].village };
      let villageInfo = await sms.getVillageById(villageId);

      let rideId = parseInt(rideInfo[0].id);
      let driverId = parseInt(driverInfo[0].id);

      console.log("Driver Info", rideInfo[0].driver_id);

      //if the driver texts yes with the request ID then they will be assigned to the rides table
      let updateRide = {
        driver_id: parseInt(driverInfo[0].id),
        assigned: true
      };
      if (answer === "yes") {
        sms
          .addDriverRideRequest(rideId, updateRide)
          .then( async request => {
            //change drivers availability to false so they will not be added to another ride request
            let update = {
              availability: false,
            };

            await sms.updateDriverAvailability(driverId, update);

            // send mothers information to driver & a text on how to complete a ride. This will allow for their availability to change to true
            if (motherInfo[0].name === null) {
              let message = `Emergency pickup request. Mother number is ${motherInfo[0].phone_number} and her village is ${villageInfo[0].name}`;

              let driverMessage = `When this ride is finished please text 915 and the request id ${request_id}. (example:915  3)`
              smsFunctions.sendDataToFrontlineSMS(message, phone_number);
              smsFunctions.sendDataToFrontlineSMS(driverMessage, phone_number);
              console.log(message);
              console.log(driverMessage)
              res.status(200).json(request);
            } else {
              let message = `Please pick up ${motherInfo[0].name}. Her village is ${villageInfo[0].name} and her phone number is ${motherInfo[0].phone_number}`;

              let driverMessage = `When this ride is finished please text 915 and the request id ${request_id}. (example:915  3)`

              smsFunctions.sendDataToFrontlineSMS(message, phone_number);
              smsFunctions.sendDataToFrontlineSMS(driverMessage, phone_number);
              console.log(driverMessage)
              console.log(message);
              res.status(200).json(request);
            }
          })
          .catch(err => console.log(err));
      }
      // if the driver texts no the, availability value will be false so we don't text them again ---> ? how do we change their availability back to true?
      else if (answer === "no") {
        let update = {
          availability: false
        };
  
        await sms.updateDriverAvailability(driverId, update);
        
        console.log("new driver mothers",villageId.id)
        let newDriver = await geo.geoLocation(villageId.id);
        let updateRide = {
          driver_id:newDriver.id,
          initiated:  moment().format()
        }
    
        sms.addDriverRideRequest(rideId, updateRide)
        .then(request => {
          
          let message = `${newDriver.driver_name}, you have a pending pickup request id of  ${rideId}. To confirm type "yes/no pickupID" (example: yes 12)`;
          smsFunctions.sendDataToFrontlineSMS(message, newDriver.phone);
      
          console.log("*No response",message);
          
          res.status(200).json(request);
        })
        .catch(err => console.log(err));
      }

      //???????This is looping on sms
      // if the driver choose yes but the ride table is complete already send info to the driver
      else if (answer === "yes" && rideInfo[0].driver_id !== null) {
        console.log("Closed Ride",rideInfo[0].driver_id)
        sms
          .getRideRequest()
          .then(request => {
            // FRONT LINE TEXT
            let message = `Sorry, this request is closed already`;
            smsFunctions.sendDataToFrontlineSMS(message, phone_number);
            res.status(200).json({ message: "request is closed already" });
          })
          .catch(err => {
            console.log(err);
            res.status(500).json(err);
          });
      }
      
      else if (answer !== "yes" || answer !== "no") {
        sms
          .getRideRequest()
          .then(request => {
            let message = `Something is wrong please send your response: answer requestID (example: yes 12)`;
            smsFunctions.sendDataToFrontlineSMS(message, phone_number);
            res
              .status(200)
              .json({ message: "Something is wrong with your response" });
          })
          .catch(err => {
            console.log(err);
            res.status(500).json(err);
          });
      }
    } catch (error) {
      console.log(error);
    }
  }
);

router.get("/drivers/reassign", async (req, res) => {
  sms.reassignFailedRides()
  .then(rides => {
    return res.status(200).json({ message: "Ride Check Complete"});
  });
})

// Ride Completion
router.put("/ride/completion/:phone/:answer", async (req, res) => {
;
  let {phone} = req.params;
  let answer = req.params.answer;

  console.log(phone, answer);
  
  let driver = await sms.findDriverPhone({phone});

  let driverId = driver[0].id;

  let data = {
    completed: true,
    ended: moment().format()
  }

  console.log("Driver id", driverId)
  
  sms.updatePendingRequest(answer, data)
  .then(check => {
    console.log("update pending", check)
    res.status(200).json({message: "Ride Updated"})
  })
    .catch(err => console.log(err));

  sms.updateDriverAvailability(driverId, {availability: true})
  .then(check => {
    console.log(check)
    let message = `Ride completed. Thank You.`
    smsFunctions.sendDataToFrontlineSMS(message, phone_number);
  })
  .catch(err => console.log(err));
})


// updating driver online/offline status
router.put("/checkonline/:phone_number/:answer", (req, res) => {

  let {phone_number} = req.params;
  let answer = req.params.answer.toLowerCase();
  if (answer === "online") {
    sms
      .statusOnline(phone_number)
      .then(clockedIn => {
        let message = `You are now clocked in`;
        smsFunctions.sendDataToFrontlineSMS(message, phone_number);
        res.status(200).json(clockedIn);
      })
      .catch(err => console.log(err));
  }
  if (answer === "offline") {
    sms
      .statusOffline(phone_number)
      .then(clockedOut => {
        let message = `You are now clocked out`;
        smsFunctions.sendDataToFrontlineSMS(message, phone_number);
        res.status(200).json(clockedOut);
      })
      .catch(err => {
        console.log(err);
        res.status(500).json(err);
      });
  }
});


/************ CODE BELOW USED TO SEE RESULTS OF CODE ABOVE ************/
// get all mothers
router.get("/mothers", (req, res) => {
  Mothers.getMothers()
    .then(mothers => {
      res.status(200).json(mothers);
    })
    .catch(err => res.status(500).json(err));
});

// get all the drivers
router.get("/drivers", (req, res) => {
  Drivers.getDrivers()
    .then(drivers => {
      res.status(200).json(drivers);
    })
    .catch(err => res.status(500).json(err));
});

//get all the rides
router.get("/rides", (req, res) => {
  sms
    .getRideRequest()
    .then(rides => res.status(200).json(rides))
    .catch(err => res.status(500).json(err));
});


module.exports = router;
