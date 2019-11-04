const router = require("express").Router();
const axios = require("axios");
const Mothers = require("../mothers/mothersHelper");
const Drivers = require("../drivers/driversHelper");
const sms = require("./smsHelper");


// test route ofr mother registration
router.get("/test/register", async (req, res) => {
  try {
    let testing = req.query;
    let data = {
      name: testing.name,
      village: 10
    };
    Mothers.addMother(data)
      .then(mother => mother)
      .catch(err => console.log(err));
    res.status(201).json({ message: "Created Mother" });
  } catch (err) {
    console.log(err);
  }
});

//for any misspelled texts
// GOAL: Check the spelling and then do the necessary trigger functionality
// ENDPOINTS: Help. Register, Yes, No, Online, Offline
router.get("/misspelled", (req, res) => {
  try {
    let text = req.query.testMessage;
    if(text !== "help"){
      let message = `text received ${text}: You misspelled something. 
      please text "help" and send it again.`
      sendDataToFrontlineSMS(message, "+699699699")
    }
  } catch (err) {
    console.log(err);
  }
})

// register mother through SMS
router.post(
  "/mothers/register/:phone_number/:village_name",
  // mothers/register/+699699699/Bugole%20A
  async (req, res) => {
    let { village_name, phone_number } = req.params;
    //Village name is an issue in Frontline. Works fine on local host.
    village_name = village_name.charAt(0).toUpperCase() + village_name.slice(1);

    let newNum = removeSpecialChar(phone_number);

    //Searching for village name in the database
    let village_search = { name: village_name };

    //Getting that village name that mother texted
    let village_list = await sms.getVillageById(village_search);

    //Grabbing the id of village from above search
    let village_id = village_list[0].id;


    //Adding that to the mothers data
    let mother_data = { phone_number: newNum, village: village_id };

    // Adding new mother to DB does not work in sms ---> have not pushed any changes
    Mothers.addMother(mother_data)
      .then(mother => {
        let message =
          "You are now registered. Please text 'help' to request a boda";
        sendDataToFrontlineSMS(message, newNum);
        res.status(201).json(mother);
      })
      .catch(err => {
        res.status(500).json(err);
      });
  }
);



// HELP
router.get("/mothers/help/:phone_number", async (req, res) => {
  try {
    // get the phone number from the link
    let { phone_number } = req.params;
    let newNum = removeSpecialChar(phone_number);
    // check if mother is registered
    let registered = await sms.checkMotherRegistration(newNum);


    if (registered && registered.length !== 0 && registered !== undefined) {
      let motherVillageId = registered[0].village;
      // search drivers on the same village
      let drivers = await sms.findDriver(motherVillageId);
      let motherId = registered[0].id;
      let data = {
        mother_id: motherId,
        ended: null,
        completed: false,
        assigned: false
      };
      sms
        .addMotherRideRequest(data)
        .then(request => {
          /** This is just temporary, we will do the 5 minutes response time filter */
          let message = `${drivers[0].name}, you have a pending pickup request id of  ${request}. To confirm type "answer pickupID" (example: yes 12)`;
          sendDataToFrontlineSMS(message, drivers[0].phone_number);
          console.log(message)
          res.status(200).json(request);
        })
        .catch(err => console.log(err));
    } else {
      let message = `To register type "register village" (example: register Iganga)`;
      sendDataToFrontlineSMS(message, newNum);
      console.log(message);
      res.status(201).json({ message: "Mother added" });
    }
  } catch (err) {
    console.log(err);
  }
});

// DRIVERS RESPONSE TO THE MESSAGE
router.post(
  "/drivers/assign/:phone_number/:answer/:request_id",
  async (req, res) => {
    try {
      let { answer, request_id, phone_number } = req.params;
      phone_number = removeSpecialChar(phone_number);
      answer = answer.toLowerCase();
      request_id = parseInt(request_id);

      console.log(phone_number + answer + request_id);

      let newPhone = { phone_number: phone_number };

      let driverInfo = await sms.findDriverPhone(newPhone);
      let rideInfo = await sms.getRideRequest(request_id);
      let motherInfo = await Mothers.getMotherForDriver(rideInfo[0].mother_id);
      let villageId = { id: motherInfo[0].village };
      let villageInfo = await sms.getVillageById(villageId);

      let rideId = parseInt(rideInfo[0].id);
      let driverId = parseInt(driverInfo[0].id);

      //if the driver press yes with the request ID then it will add to the rides table
      let updateRide = {
        driver_id: parseInt(driverInfo[0].id)
      };
      if (answer === "yes" && rideInfo[0].driver_id === null) {
        sms
          .addDriverRideRequest(rideId, updateRide)
          .then(request => {
            let update = {
              availability: false
            };
            changeDriverAvailability(driverId, update);

            // send mothers information to driver
            if (motherInfo[0].name === null) {
              let message = `Emergency pickup request. Mother number is ${motherInfo[0].phone_number} and her village is ${villageInfo[0].name}`;
              sendDataToFrontlineSMS(message, phone_number)
              console.log(message);
              res.status(200).json(request)
            }
            else {
              let message = `Please pick up ${motherInfo[0].name}. Her village is ${villageInfo[0].name} and her phone number is ${motherInfo[0].phone_number}`;
              sendDataToFrontlineSMS(message, phone_number)
              console.log(message);
              res.status(200).json(request)
            }

          })
          .catch(err => console.log(err));

      }
      // if the driver choose no the availability value will be false
      else if (answer === "no") {
        let update = {
          availability: false
        };
        //The No trigger does not work: TypeError: Cannot read property 'then' of undefined  ---> need to push changes
        changeDriverAvailability(driverId, update);
      }
      //This is looping on sms
      // if the driver choose yes but the ride table is complete already send info to the driver
      else if (answer === "yes" && rideInfo[0].driver_id !== null) {
        sms.getRideRequest()
          .then(request => {
            // FRONT LINE TEXT
            let message = `Sorry, this request is closed already`
            sendDataToFrontlineSMS(message, phone_number)
            res.status(200).json({ message: 'request is closed already' });
          })
          .catch(err => {
            console.log(err)
            res.status(500).json(err)
          })
      }
      // make else if for lat and long if there is no driver available on the same village id
      else if (answer !== "yes" || answer !== "no") {
        sms.getRideRequest()
          .then(request => {
            let message = `Something is wrong please send your response: answer requestID (example: yes 12)`
            sendDataToFrontlineSMS(message, phone_number);
            res.status(200).json({ message: "Something is wrong with your response" });
          })
          .catch(err => {
            console.log(err)
            res.status(500).json(err)
          })
      }
    } catch (error) {
      console.log(error);
    }
  }
);

function changeDriverAvailability(id, data) {
  sms
    .updateDriverAvailability(id, data)
    .then(driver => driver)
    .catch(err => console.log(err));
}

// get all mothers
router.get("/mothers", (req, res) => {
  Mothers.getMothers()
    .then(mothers => {
      res.status(200).json(mothers);
    })
    .catch(err => res.status(500).json(err));
});

// updating driver online/offline status
router.put("/checkonline/:phone_number/:answer", (req, res) => {
  let phone_number = removeSpecialChar(req.params.phone_number);
  let answer = req.params.answer.toLowerCase();
  if (answer === "online") {
    sms
      .statusOnline(phone_number)
      .then(clockedIn => {
        let message = `You are now clocked in`
        sendDataToFrontlineSMS(message, phone_number);
        res.status(200).json(clockedIn)
      })
      .catch(err => console.log(err));
  }
  if (answer === "offline") {
    sms
      .statusOffline(phone_number)
      .then(clockedOut => {
        let message = `You are now clocked out`
        sendDataToFrontlineSMS(message, phone_number);
        res.status(200).json(clockedOut)
      })
      .catch(err => {
        console.log(err)
        res.status(500).json(err)
      });
  }
});

// get all the drivers
router.get("/drivers", (req, res) => {
  Drivers.getDrivers()
    .then(drivers => {
      res.status(200).json(drivers);
    })
    .catch(err => res.status(500).json(err));
});

router.get("/rides", (req, res) => {
  sms
    .getRideRequest()
    .then(rides => res.status(200).json(rides))
    .catch(err => res.status(500).json(err));
});

/*** FUNCTIONS */

function removeSpecialChar(num) {
  // remove whitespaces and + in the phone number
  var regexPhoneNumber = /[^a-zA-Z0-9]+/gi;
  return num.replace(regexPhoneNumber, " ").trim();
}

/** MAKE SURE YOU HAVE THE .env FILE */
function sendDataToFrontlineSMS(message, phone_number) {
  let payload = {
    apiKey: process.env.FRONTLINE_KEY,
    payload: {
      message: message,
      recipients: [{ type: "mobile", value: `+${phone_number}` }]
    }
  };
  let url = "https://cloud.frontlinesms.com/api/1/webhook";
  axios.post(url, payload);
}

module.exports = router;
